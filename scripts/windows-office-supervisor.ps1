[CmdletBinding()]
param(
  [string]$OfficeIp = "192.168.1.211",
  [string]$HttpsProfile = "windows-192.168.1.211",
  [switch]$ChildRunner,
  [string]$GateName = "",
  [string]$ChildPnpmPath = "",
  [string]$ChildWorkingDirectory = "",
  [string]$ChildLogPath = ""
)

# This branch runs in a separate PowerShell process. It waits until the parent
# has placed it in a kill-on-close Windows Job Object before it starts pnpm.
if ($ChildRunner) {
  $ErrorActionPreference = "Continue"
  $childExitCode = 1

  try {
    if (
      [string]::IsNullOrWhiteSpace($GateName) -or
      [string]::IsNullOrWhiteSpace($ChildPnpmPath) -or
      [string]::IsNullOrWhiteSpace($ChildWorkingDirectory) -or
      [string]::IsNullOrWhiteSpace($ChildLogPath)
    ) {
      throw "The Windows host runner did not receive all required values."
    }

    Set-Location -LiteralPath $ChildWorkingDirectory
    $startGate = [System.Threading.EventWaitHandle]::OpenExisting($GateName)
    try {
      [void]$startGate.WaitOne()
    } finally {
      $startGate.Dispose()
    }

    & $ChildPnpmPath "office:https" 2>&1 |
      ForEach-Object {
        $outputLine = [string]$_
        Write-Host $outputLine
        try {
          $timestampedLine = "[{0}] {1}" -f (
            Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
          ), $outputLine
          Add-Content `
            -LiteralPath $ChildLogPath `
            -Value $timestampedLine `
            -Encoding UTF8 `
            -ErrorAction Stop
        } catch {
          Write-Host "OZMO warning: the host log could not be updated."
        }
      }

    if ($null -ne $LASTEXITCODE) {
      $childExitCode = [int]$LASTEXITCODE
    } else {
      $childExitCode = 0
    }
  } catch {
    $failureText = "OZMO child runner failed: {0}" -f $_.Exception.Message
    Write-Host $failureText
    try {
      Add-Content `
        -LiteralPath $ChildLogPath `
        -Value ("[{0}] {1}" -f (
          Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
        ), $failureText) `
        -Encoding UTF8 `
        -ErrorAction Stop
    } catch {
      Write-Host "OZMO warning: the host log could not be updated."
    }
    $childExitCode = 1
  }

  exit $childExitCode
}

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$env:OZMO_OFFICE_IP = $OfficeIp
$env:OZMO_HTTPS_PROFILE = $HttpsProfile

$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
if ([string]::IsNullOrWhiteSpace($localAppData)) {
  $localAppData = Join-Path $projectRoot ".wrangler"
}

$ozmoRuntimeDirectory = Join-Path $localAppData "OZMO"
$logDirectory = Join-Path $ozmoRuntimeDirectory "logs"
$logPath = Join-Path $logDirectory "host.log"
$lockPath = Join-Path $ozmoRuntimeDirectory "host.lock"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-OzmoHostLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  try {
    Add-Content `
      -LiteralPath $logPath `
      -Value $line `
      -Encoding UTF8 `
      -ErrorAction Stop
  } catch {
    Write-Host "OZMO warning: the host log could not be updated."
  }
}

function Rotate-OzmoHostLog {
  try {
    if (
      (Test-Path -LiteralPath $logPath) -and
      ((Get-Item -LiteralPath $logPath).Length -ge 20MB)
    ) {
      $archiveName = "host-{0}.log" -f (
        Get-Date -Format "yyyyMMdd-HHmmss-fff"
      )
      $archivePath = Join-Path $logDirectory $archiveName
      Move-Item `
        -LiteralPath $logPath `
        -Destination $archivePath `
        -ErrorAction Stop
      Write-OzmoHostLog "The previous 20 MB host log was archived as $archiveName."
    }
  } catch {
    Write-Host "OZMO warning: the host log could not be rotated."
  }
}

function Quote-OzmoProcessArgument {
  param([string]$Value)

  if ($Value.Contains('"')) {
    throw "A Windows host path contains an unsupported quote character."
  }
  $trailingBackslashes = [regex]::Match($Value, "\\+$")
  if ($trailingBackslashes.Success) {
    $Value += $trailingBackslashes.Value
  }
  return '"{0}"' -f $Value
}

$nativeSource = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

namespace OzmoOffice {
  public static class NativeHost {
    private const UInt32 ES_CONTINUOUS = 0x80000000;
    private const UInt32 ES_SYSTEM_REQUIRED = 0x00000001;
    private const UInt32 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const Int32 JobObjectBasicAccountingInformation = 1;
    private const Int32 JobObjectExtendedLimitInformation = 9;

    private static HandlerRoutine handler;
    private static Int32 stopRequested;
    private static Int32 immediateStopRequested;
    private static IntPtr activeJob = IntPtr.Zero;

    public enum CtrlType {
      CtrlC = 0,
      CtrlBreak = 1,
      ConsoleClose = 2,
      Logoff = 5,
      Shutdown = 6
    }

    private delegate Boolean HandlerRoutine(CtrlType ctrlType);

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
      public Int64 TotalUserTime;
      public Int64 TotalKernelTime;
      public Int64 ThisPeriodTotalUserTime;
      public Int64 ThisPeriodTotalKernelTime;
      public UInt32 TotalPageFaultCount;
      public UInt32 TotalProcesses;
      public UInt32 ActiveProcesses;
      public UInt32 TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
      public Int64 PerProcessUserTimeLimit;
      public Int64 PerJobUserTimeLimit;
      public UInt32 LimitFlags;
      public UIntPtr MinimumWorkingSetSize;
      public UIntPtr MaximumWorkingSetSize;
      public UInt32 ActiveProcessLimit;
      public UIntPtr Affinity;
      public UInt32 PriorityClass;
      public UInt32 SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS {
      public UInt64 ReadOperationCount;
      public UInt64 WriteOperationCount;
      public UInt64 OtherOperationCount;
      public UInt64 ReadTransferCount;
      public UInt64 WriteTransferCount;
      public UInt64 OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
      public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
      public IO_COUNTERS IoInfo;
      public UIntPtr ProcessMemoryLimit;
      public UIntPtr JobMemoryLimit;
      public UIntPtr PeakProcessMemoryUsed;
      public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern UInt32 SetThreadExecutionState(UInt32 executionState);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(
      IntPtr jobAttributes,
      String name
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern Boolean SetInformationJobObject(
      IntPtr job,
      Int32 informationClass,
      IntPtr information,
      UInt32 informationLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern Boolean QueryInformationJobObject(
      IntPtr job,
      Int32 informationClass,
      IntPtr information,
      UInt32 informationLength,
      out UInt32 returnedLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern Boolean AssignProcessToJobObject(
      IntPtr job,
      IntPtr process
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern Boolean TerminateJobObject(
      IntPtr job,
      UInt32 exitCode
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern Boolean CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern Boolean SetConsoleCtrlHandler(
      HandlerRoutine handlerRoutine,
      Boolean add
    );

    public static Boolean PreventIdleSleep() {
      return SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) != 0;
    }

    public static void RestoreNormalSleep() {
      SetThreadExecutionState(ES_CONTINUOUS);
    }

    public static void InstallConsoleHandler() {
      handler = new HandlerRoutine(HandleConsoleControl);
      if (!SetConsoleCtrlHandler(handler, true)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    }

    public static Boolean StopRequested {
      get { return Interlocked.CompareExchange(ref stopRequested, 0, 0) != 0; }
    }

    public static Boolean ImmediateStopRequested {
      get {
        return Interlocked.CompareExchange(
          ref immediateStopRequested,
          0,
          0
        ) != 0;
      }
    }

    private static Boolean HandleConsoleControl(CtrlType ctrlType) {
      Interlocked.Exchange(ref stopRequested, 1);
      if (ctrlType == CtrlType.CtrlC || ctrlType == CtrlType.CtrlBreak) {
        return true;
      }

      Interlocked.Exchange(ref immediateStopRequested, 1);
      IntPtr job = Interlocked.CompareExchange(
        ref activeJob,
        IntPtr.Zero,
        IntPtr.Zero
      );
      if (job != IntPtr.Zero) {
        TerminateJobObject(job, 1);
      }
      return true;
    }

    public static IntPtr CreateKillOnCloseJob() {
      IntPtr job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      JOBOBJECT_EXTENDED_LIMIT_INFORMATION information =
        new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      information.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

      Int32 length = Marshal.SizeOf(
        typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)
      );
      IntPtr pointer = Marshal.AllocHGlobal(length);
      try {
        Marshal.StructureToPtr(information, pointer, false);
        if (!SetInformationJobObject(
          job,
          JobObjectExtendedLimitInformation,
          pointer,
          (UInt32)length
        )) {
          Int32 error = Marshal.GetLastWin32Error();
          CloseHandle(job);
          throw new Win32Exception(error);
        }
      } finally {
        Marshal.FreeHGlobal(pointer);
      }

      return job;
    }

    public static void AssignToJob(IntPtr job, IntPtr process) {
      if (!AssignProcessToJobObject(job, process)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      Interlocked.Exchange(ref activeJob, job);
    }

    public static UInt32 GetActiveProcessCount(IntPtr job) {
      Int32 length = Marshal.SizeOf(
        typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)
      );
      IntPtr pointer = Marshal.AllocHGlobal(length);
      try {
        UInt32 returnedLength;
        if (!QueryInformationJobObject(
          job,
          JobObjectBasicAccountingInformation,
          pointer,
          (UInt32)length,
          out returnedLength
        )) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information =
          (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(
            pointer,
            typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)
          );
        return information.ActiveProcesses;
      } finally {
        Marshal.FreeHGlobal(pointer);
      }
    }

    public static void CloseJob(IntPtr job) {
      if (job == IntPtr.Zero) {
        return;
      }
      Interlocked.CompareExchange(ref activeJob, IntPtr.Zero, job);
      CloseHandle(job);
    }

    public static void KillAndCloseJob(IntPtr job) {
      if (job == IntPtr.Zero) {
        return;
      }
      Interlocked.CompareExchange(ref activeJob, IntPtr.Zero, job);
      TerminateJobObject(job, 1);
      CloseHandle(job);
    }
  }
}
"@

$sleepGuardEnabled = $false
$nativeReady = $false
$lockStream = $null
$exitStatus = 0

try {
  Add-Type -TypeDefinition $nativeSource -ErrorAction Stop
  $nativeReady = $true
  [OzmoOffice.NativeHost]::InstallConsoleHandler()

  try {
    $lockStream = [System.IO.File]::Open(
      $lockPath,
      [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
  } catch {
    throw (
      "Another OZMO Windows host supervisor is already open. " +
      "Close the other OZMO host window before starting a second one."
    )
  }

  Rotate-OzmoHostLog
  $sleepGuardEnabled = [OzmoOffice.NativeHost]::PreventIdleSleep()
  if ($sleepGuardEnabled) {
    Write-OzmoHostLog "Windows idle-sleep prevention is active."
  } else {
    Write-OzmoHostLog "Warning: Windows idle-sleep prevention could not be enabled."
  }

  $pnpmCommand = Get-Command `
    "pnpm.cmd" `
    -CommandType Application `
    -ErrorAction SilentlyContinue
  if (-not $pnpmCommand) {
    $pnpmCommand = Get-Command `
      "pnpm" `
      -CommandType Application `
      -ErrorAction SilentlyContinue
  }
  if (-not $pnpmCommand) {
    throw "pnpm was not found. Run: npm install --global pnpm"
  }

  $powerShellCommand = Get-Command `
    "powershell.exe" `
    -CommandType Application `
    -ErrorAction Stop
  $pnpmPath = $pnpmCommand.Source
  $powerShellPath = $powerShellCommand.Source
  $supervisorPath = $MyInvocation.MyCommand.Path
  $restartDelays = @(2, 4, 8, 16, 30)
  $restartAttempt = 0
  $rapidFailures = 0

  while (-not [OzmoOffice.NativeHost]::StopRequested) {
    Rotate-OzmoHostLog
    $startedAt = Get-Date
    $process = $null
    $startGate = $null
    $job = [IntPtr]::Zero
    $exitCode = 1

    try {
      $gateName = "Local\OZMO-HOST-{0}" -f [Guid]::NewGuid().ToString("N")
      $startGate = [System.Threading.EventWaitHandle]::new(
        $false,
        [System.Threading.EventResetMode]::ManualReset,
        $gateName
      )

      $childArguments = @(
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy Bypass",
        "-File $(Quote-OzmoProcessArgument $supervisorPath)",
        "-ChildRunner",
        "-GateName $(Quote-OzmoProcessArgument $gateName)",
        "-ChildPnpmPath $(Quote-OzmoProcessArgument $pnpmPath)",
        "-ChildWorkingDirectory $(Quote-OzmoProcessArgument $projectRoot)",
        "-ChildLogPath $(Quote-OzmoProcessArgument $logPath)"
      ) -join " "

      $processInfo = New-Object System.Diagnostics.ProcessStartInfo
      $processInfo.FileName = $powerShellPath
      $processInfo.Arguments = $childArguments
      $processInfo.WorkingDirectory = $projectRoot
      $processInfo.UseShellExecute = $false
      $processInfo.CreateNoWindow = $false

      $process = New-Object System.Diagnostics.Process
      $process.StartInfo = $processInfo

      Write-OzmoHostLog "Starting OZMO at https://${OfficeIp}:3000"
      Write-Host "Keep this window open. Press Control+C to stop the host."
      Write-Host "Troubleshooting log: $logPath"
      Write-Host ""

      if (-not $process.Start()) {
        throw "Windows could not start the OZMO child process."
      }

      $job = [OzmoOffice.NativeHost]::CreateKillOnCloseJob()
      [OzmoOffice.NativeHost]::AssignToJob($job, $process.Handle)
      [void]$startGate.Set()

      while (
        (-not $process.HasExited) -and
        (-not [OzmoOffice.NativeHost]::StopRequested)
      ) {
        Start-Sleep -Milliseconds 250
      }

      if ([OzmoOffice.NativeHost]::StopRequested) {
        if (-not [OzmoOffice.NativeHost]::ImmediateStopRequested) {
          $gracefulStopDeadline = (Get-Date).AddSeconds(10)
          while (
            ((Get-Date) -lt $gracefulStopDeadline) -and
            (-not [OzmoOffice.NativeHost]::ImmediateStopRequested)
          ) {
            if (
              [OzmoOffice.NativeHost]::GetActiveProcessCount($job) -eq 0
            ) {
              break
            }
            Start-Sleep -Milliseconds 250
          }
        }
        if (
          [OzmoOffice.NativeHost]::ImmediateStopRequested -or
          ([OzmoOffice.NativeHost]::GetActiveProcessCount($job) -gt 0)
        ) {
          [OzmoOffice.NativeHost]::KillAndCloseJob($job)
          [void]$process.WaitForExit(5000)
        } else {
          [OzmoOffice.NativeHost]::CloseJob($job)
        }
        $job = [IntPtr]::Zero
        break
      }

      $process.WaitForExit()
      $exitCode = [int]$process.ExitCode
    } catch {
      Write-OzmoHostLog ("OZMO run failed: {0}" -f $_.Exception.Message)
      $exitCode = 1
    } finally {
      if ($job -ne [IntPtr]::Zero) {
        [OzmoOffice.NativeHost]::KillAndCloseJob($job)
      }
      if ($startGate) {
        $startGate.Dispose()
      }
      if ($process) {
        try {
          if (-not $process.HasExited) {
            $process.Kill()
            [void]$process.WaitForExit(5000)
          }
        } catch {
          # The process may already have closed between the status check and kill.
        }
        $process.Dispose()
      }
    }

    if ([OzmoOffice.NativeHost]::StopRequested) {
      break
    }

    $runtime = (Get-Date) - $startedAt
    Write-OzmoHostLog (
      "OZMO stopped with exit code {0} after {1} minute(s)." -f
      $exitCode,
      [Math]::Round($runtime.TotalMinutes, 1)
    )

    if ($runtime.TotalMinutes -lt 5) {
      $rapidFailures += 1
    } else {
      $rapidFailures = 0
      $restartAttempt = 0
    }
    if ($rapidFailures -ge 5) {
      throw (
        "OZMO stopped five times in less than five minutes. " +
        "The automatic restart loop was paused to protect this computer. " +
        "Review the troubleshooting log before trying again."
      )
    }
    $delayIndex = [Math]::Min(
      $restartAttempt,
      $restartDelays.Count - 1
    )
    $restartDelay = $restartDelays[$delayIndex]
    $restartAttempt += 1
    Write-OzmoHostLog (
      "Restarting automatically in {0} second(s)." -f $restartDelay
    )

    $restartAt = (Get-Date).AddSeconds($restartDelay)
    while (
      ((Get-Date) -lt $restartAt) -and
      (-not [OzmoOffice.NativeHost]::StopRequested)
    ) {
      Start-Sleep -Milliseconds 250
    }
  }

  Write-OzmoHostLog "OZMO host stopped by Windows or the user."
} catch {
  if ($nativeReady -and [OzmoOffice.NativeHost]::StopRequested) {
    $exitStatus = 0
  } else {
    Write-OzmoHostLog ("Host supervisor stopped: {0}" -f $_.Exception.Message)
    Write-Host ""
    Write-Host "OZMO could not stay running. Keep this message visible."
    Write-Host "Troubleshooting log: $logPath"
    $exitStatus = 1
  }
} finally {
  if ($sleepGuardEnabled -and $nativeReady) {
    [OzmoOffice.NativeHost]::RestoreNormalSleep()
  }
  if ($lockStream) {
    $lockStream.Dispose()
  }
}

exit $exitStatus
