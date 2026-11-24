// Servico do Windows que mantem o sistema no ar. Roda com o usuario escolhido na instalacao (para ter acesso as redes dele).
// Compilado no proprio servidor pelo instalar-servico.ps1. Com --console roda fora do servico, para teste.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using Microsoft.Win32;

public class JCColetor : ServiceBase
{
    readonly string raiz = Path.GetDirectoryName(Path.GetDirectoryName(typeof(JCColetor).Assembly.Location)); // servico\ fica dentro da raiz
    readonly object trava = new object();
    Process node; volatile bool parando; Thread laco; IntPtr job = IntPtr.Zero;
    string porta = Environment.GetEnvironmentVariable("JC_PORTA") ?? "3090";

    public JCColetor() { ServiceName = "JCColetor"; CanShutdown = true; }

    public static void Main(string[] a)
    {
        var s = new JCColetor();
        if (a.Length > 0 && a[0] == "--console") { s.OnStart(null); Console.In.ReadLine(); s.OnStop(); return; }
        ServiceBase.Run(s);
    }

    protected override void OnStart(string[] args)
    {
        job = CriarJob();
        laco = new Thread(Rodar) { IsBackground = true };
        laco.Start();
    }
    protected override void OnStop()
    {
        parando = true;
        lock (trava) { try { if (node != null && !node.HasExited) node.Kill(); } catch { } }
        if (laco != null) laco.Join(10000);
        if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
        Log("Servico parado.");
    }
    protected override void OnShutdown() { OnStop(); }

    void Rodar()
    {
        Log("Servico iniciado por " + Environment.UserDomainName + "\\" + Environment.UserName);
        Unidades();
        while (!parando)
        {
            try
            {
                var i = new ProcessStartInfo(Path.Combine(raiz, "node.exe"), "node_modules\\next\\dist\\bin\\next start -H 0.0.0.0 -p " + porta)
                { WorkingDirectory = raiz, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
                Process p = new Process { StartInfo = i };
                p.OutputDataReceived += delegate(object o, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
                p.ErrorDataReceived += delegate(object o, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
                lock (trava) { if (parando) return; p.Start(); node = p; }
                // se o servico morrer de repente, o Windows encerra o node junto
                if (job != IntPtr.Zero) AssignProcessToJobObject(job, p.Handle);
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                p.WaitForExit();
                if (!parando) Log("O sistema parou (codigo " + p.ExitCode + "). Abrindo de novo em 5 segundos.");
            }
            catch (Exception e) { Log("ERRO ao abrir o sistema: " + e.Message); }
            for (int n = 0; n < 50 && !parando; n++) Thread.Sleep(100);
        }
    }

    // Servico nao enxerga as unidades mapeadas (Z:) da area de trabalho: refaz as do usuario nesta sessao.
    void Unidades()
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey("Network"))
            {
                if (k == null) return;
                foreach (string l in k.GetSubKeyNames())
                    using (RegistryKey u = k.OpenSubKey(l))
                    {
                        string destino = u.GetValue("RemotePath") as string;
                        if (string.IsNullOrEmpty(destino) || l.Length != 1 || Directory.Exists(l + ":\\")) continue;
                        for (int t = 1; t <= 6 && !parando; t++)
                        {
                            var r = new NETRESOURCE { dwType = 1, lpLocalName = l.ToUpper() + ":", lpRemoteName = destino };
                            int cod = WNetAddConnection2(ref r, null, null, 0);
                            if (cod == 0 || cod == 85) { Log("Unidade " + l + ": = " + destino); break; }
                            Log("Unidade " + l + ": (" + destino + ") nao abriu: " + new System.ComponentModel.Win32Exception(cod).Message);
                            // rede ainda subindo apos ligar o servidor: tenta de novo. Senha/acesso negado nao adianta (e pode bloquear a conta).
                            if (cod != 53 && cod != 67 && cod != 64 && cod != 1203 && cod != 1222 && cod != 1231) break;
                            for (int n = 0; n < 50 && !parando; n++) Thread.Sleep(100);
                        }
                    }
            }
        }
        catch (Exception e) { Log("Unidades de rede: " + e.Message); }
    }

    void Log(string t)
    {
        lock (trava)
        {
            try
            {
                string d = Path.Combine(raiz, "logs"), f = Path.Combine(d, "servico.log");
                Directory.CreateDirectory(d);
                if (File.Exists(f) && new FileInfo(f).Length > 5 * 1024 * 1024) { string v = Path.Combine(d, "servico.anterior.log"); File.Delete(v); File.Move(f, v); }
                File.AppendAllText(f, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + t + Environment.NewLine, new UTF8Encoding(false));
            }
            catch { }
        }
    }

    static IntPtr CriarJob()
    {
        IntPtr h = CreateJobObject(IntPtr.Zero, null);
        if (h == IntPtr.Zero) return h;
        var x = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        x.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
        int n = Marshal.SizeOf(x); IntPtr m = Marshal.AllocHGlobal(n);
        try { Marshal.StructureToPtr(x, m, false); SetInformationJobObject(h, 9, m, (uint)n); } finally { Marshal.FreeHGlobal(m); }
        return h;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct NETRESOURCE { public int dwScope, dwType, dwDisplayType, dwUsage; public string lpLocalName, lpRemoteName, lpComment, lpProvider; }
    [StructLayout(LayoutKind.Sequential)]
    struct BASIC { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)]
    struct IO { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public BASIC Basic; public IO Io; public UIntPtr a, b, c, d; }
    [DllImport("mpr.dll", CharSet = CharSet.Unicode)] static extern int WNetAddConnection2(ref NETRESOURCE r, string senha, string usuario, int flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, uint n);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
}
