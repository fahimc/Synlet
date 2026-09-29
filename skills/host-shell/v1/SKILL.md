# Host shell investigation and operation v1

Use this skill for host inspection, machine maintenance, process management, system
health, installed software, files outside the configured workspace, networking, or
any other task that needs the unrestricted command line.

## Workflow

1. Start with a shell-neutral `command.run` probe using only `pwd`. Do not choose a
   PowerShell or POSIX branch before this observation. The command tool result returns
   authoritative `platform`, `shell`, and `cwd` fields even if the command itself is
   minimal. Do not infer the OS from the user’s wording, a remembered deployment
   target, or command names seen in old observations.
2. Choose subsequent commands for the observed OS and shell, then verify further host
   details in-band when the task needs them: in PowerShell, inspect `$PSVersionTable`,
   `[System.Environment]::OSVersion`, and
   `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture`; in a POSIX
   shell, inspect `uname` and the available shell/version variables. The command tool has the
   launch user’s full host filesystem, process, environment, executable, and network
   access; it is not restricted to the workspace and has no command allow-list.
3. Before relying on an unfamiliar command, inspect the installed command’s native
   help, syntax, available subcommands, properties, counters, or providers. Installed
   capabilities are authoritative; remembered syntax is not.
   In PowerShell, use `Get-Command <name> -Syntax` and `Get-Help <name>`, then use the
   command's listing/discovery mode before constructing a provider path or property
   query. For CIM/WMI, discover available classes and properties instead of guessing
   them. For performance providers, enumerate installed sets and paths before selecting
   a measurement. In POSIX shells, use `command -v`, `--help`, manual pages, and
   `/proc`/`sysctl` capability discovery as available.
4. Prefer direct read-only observation before mutation. Keep commands non-interactive,
   bounded, and explicit so their output and exit status can be captured in the trace.
5. Treat a non-zero exit, blank requested field, mismatched unit, unrelated column,
   cumulative value used as a current rate, or stale result as a failed attempt. Do not
   turn missing output into zero and do not repeat an identical failed command.
6. Diagnose failure from stderr and returned shell diagnostics, then use help/discovery
   or a different OS-appropriate method. One unavailable command or property does not
   prove that the requested host capability is unavailable.
   When native command syntax is unreliable, discover an installed scripting runtime
   and use its standard system APIs as another general method rather than inventing a
   task-specific host route.
7. Finish only when successful command output directly supports the requested result.
   Preserve the user’s requested quantity, units, scope, and output shape.

This skill describes a portable investigation process plus a broad operational
reference. Skill selection and command construction remain model-driven; the host must
not add hidden intent-to-command routes or fixed answer values.

## Host command reference

These are portable starting points, not fixed routes. Confirm that each command exists
and inspect its installed syntax before relying on it. Prefer concise labelled output
so units and meaning remain unambiguous in later observations.

### Windows PowerShell

- Host preflight: `$PSVersionTable.PSVersion; [System.Environment]::OSVersion;
  [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture; Get-Location`
- Local time context: `Get-Date -Format o; [TimeZoneInfo]::Local.Id`
- Current total processor utilization: read the installed `Get-Counter` syntax and
  enumerate the `Processor` counter set, then sample the total `% Processor Time`
  path. Return a labelled percentage, for example:
  `$v=(Get-Counter '\Processor(_Total)\% Processor Time' -MaxSamples 1).CounterSamples.CookedValue;
  'CPU utilization percent: {0:N1}' -f $v`
- Memory: inspect `Win32_OperatingSystem` memory properties and calculate a labelled
  used/total percentage from the observed values.
- Filesystems: inspect `Get-Volume`, `Get-PSDrive -PSProvider FileSystem`, or the
  corresponding CIM storage classes before reporting capacity or free space.
- Processes and services: use `Get-Process`, `Get-Service`, CIM process data, or
  performance counters according to whether the request concerns identity, cumulative
  time, or a current rate. A process `CPU` column is cumulative processor seconds, not
  current system utilization.
- Network: inspect `Get-NetAdapter`, `Get-NetIPConfiguration`, connection cmdlets, and
  adapter performance counters as appropriate.

### Linux and other POSIX hosts

- Host preflight: `uname -a; printf '%s\n' "$SHELL"; pwd`
- Local time context: use the installed `date` implementation and timezone files or
  runtime APIs, checking supported flags first.
- Current processor utilization: inspect available `top`, `vmstat`, `mpstat`, or
  `/proc/stat` interfaces and sample a rate over a real interval; do not report load
  average or cumulative jiffies as utilization percentage.
- Memory and filesystems: inspect available `free`, `/proc/meminfo`, `vm_stat`, `df`,
  `mount`, or `sysctl` interfaces and retain their units.
- Processes, services, and network: discover installed `ps`, service manager,
  `ss`/`netstat`, interface, and platform-specific tools before querying them.

If the native utilities are missing or inconsistent, first discover an installed
runtime such as Node.js or Python, inspect its standard system APIs, and execute a
short script through `command.run`. This remains ordinary unrestricted shell use; it
must not be replaced by a host-side semantic tool.
