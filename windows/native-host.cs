// Windows / .NET Framework 4.x. No image files, clipboard, network, or background service.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;

[DataContract]
public sealed class HostMessage
{
    [DataMember(EmitDefaultValue = false)] public string command;
    [DataMember(EmitDefaultValue = false)] public string type;
    [DataMember(EmitDefaultValue = false)] public string message;
    [DataMember(EmitDefaultValue = false)] public string data;
    [DataMember] public int index;
    [DataMember] public int length;
}

public static class CaptureHost
{
    private const int ChunkSize = 512 * 1024;
    private static readonly Stream Input = Console.OpenStandardInput();
    private static readonly Stream Output = Console.OpenStandardOutput();
    private static IntPtr sourceWindow = IntPtr.Zero;
    private static RECT screen;

    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MONITORINFO
    { public int Size; public RECT Monitor; public RECT Work; public int Flags; }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int awareness);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();

    private static void EnablePhysicalPixels()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) { }
        try { if (SetProcessDpiAwareness(2) == 0) return; } catch (DllNotFoundException) { }
        SetProcessDPIAware();
    }

    // Native messaging uses a four-byte little-endian size and UTF-8 JSON.
    private static byte[] ReadExactly(int size)
    {
        byte[] bytes = new byte[size]; int offset = 0;
        while (offset < size)
        {
            int read = Input.Read(bytes, offset, size - offset);
            if (read == 0) { if (offset == 0) return null; throw new EndOfStreamException(); }
            offset += read;
        }
        return bytes;
    }
    private static HostMessage ReadMessage()
    {
        byte[] prefix = ReadExactly(4); if (prefix == null) return null;
        int length = BitConverter.ToInt32(prefix, 0);
        if (length < 1 || length > 4096) throw new InvalidDataException("Invalid request length.");
        byte[] data = ReadExactly(length); if (data == null) throw new EndOfStreamException();
        using (MemoryStream buffer = new MemoryStream(data))
            return (HostMessage)new DataContractJsonSerializer(typeof(HostMessage)).ReadObject(buffer);
    }
    private static void WriteMessage(HostMessage value)
    {
        using (MemoryStream buffer = new MemoryStream())
        {
            new DataContractJsonSerializer(typeof(HostMessage)).WriteObject(buffer, value);
            byte[] bytes = buffer.ToArray();
            if (bytes.Length > 1024 * 1024) throw new InvalidDataException("Native message exceeds 1 MB.");
            byte[] prefix = BitConverter.GetBytes(bytes.Length);
            Output.Write(prefix, 0, prefix.Length); Output.Write(bytes, 0, bytes.Length); Output.Flush();
        }
    }

    private static void Prepare()
    {
        sourceWindow = IntPtr.Zero;
        IntPtr window = GetForegroundWindow(); uint processId;
        GetWindowThreadProcessId(window, out processId);
        using (Process process = Process.GetProcessById((int)processId))
            if (!String.Equals(process.ProcessName, "msedge", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Keep the ChatGPT Edge window in front, then retry.");
        MONITORINFO info = new MONITORINFO(); info.Size = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref info)) throw new InvalidOperationException("Cannot locate the Edge monitor.");
        screen = info.Monitor; sourceWindow = window;
        WriteMessage(new HostMessage { type = "prepared" });
    }
    private static void Capture()
    {
        if (sourceWindow == IntPtr.Zero || !IsWindow(sourceWindow) || !IsIconic(sourceWindow))
            throw new InvalidOperationException("The source Edge window must be minimized before capture.");
        // Wait for the minimize animation and the compositor's next frame.
        Thread.Sleep(150); DwmFlush();
        if (!IsWindow(sourceWindow) || !IsIconic(sourceWindow))
            throw new InvalidOperationException("The source window was restored before capture. Retry.");
        int width = screen.Right - screen.Left, height = screen.Bottom - screen.Top;
        if (width < 1 || height < 1 || (long)width * height > 50000000)
            throw new InvalidOperationException("The display size is not supported.");
        string image;
        using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        using (MemoryStream buffer = new MemoryStream())
        {
            graphics.CopyFromScreen(screen.Left, screen.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
            bitmap.Save(buffer, ImageFormat.Png);
            if (buffer.Length > 32 * 1024 * 1024) throw new InvalidOperationException("The screenshot exceeds 32 MB.");
            image = Convert.ToBase64String(buffer.ToArray());
        }
        WriteMessage(new HostMessage { type = "imageStart", length = image.Length });
        for (int offset = 0, index = 0; offset < image.Length; offset += ChunkSize, index++)
            WriteMessage(new HostMessage { type = "imageChunk", index = index, data = image.Substring(offset, Math.Min(ChunkSize, image.Length - offset)) });
        WriteMessage(new HostMessage { type = "imageEnd" });
        sourceWindow = IntPtr.Zero;
    }
    public static int Main()
    {
        try
        {
            EnablePhysicalPixels();
            HostMessage request;
            while ((request = ReadMessage()) != null)
            {
                try
                {
                    if (request.command == "ping") WriteMessage(new HostMessage { type = "pong" });
                    else if (request.command == "prepare") Prepare();
                    else if (request.command == "capture") Capture();
                    else throw new InvalidOperationException("Unknown command.");
                }
                catch (Exception error) { sourceWindow = IntPtr.Zero; WriteMessage(new HostMessage { type = "error", message = error.Message }); }
            }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
