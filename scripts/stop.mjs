// Stops all local dev services (web, api, jobs) for this project.
// Strategy: kill by command-line pattern (scoped to the project path) in
// repeated rounds — wrangler respawns its workerd children, so killing once
// isn't enough — then clear any listeners still holding the dev ports.
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Derived from this file's location so the script works from any clone path.
const PROJECT = dirname(dirname(fileURLToPath(import.meta.url)))
const PORTS = [3000, 3001, 8787, 8788]
// Broad "wrangler" match is intentional: the process cmdline varies between
// bin/wrangler.js dev and wrangler-dist/cli.js dev depending on how pnpm
// resolves the binary. Project-path filtering keeps it safe.
const PATTERNS = ['dev.mjs', 'vite dev', 'wrangler', 'workerd serve']
const ROUNDS = 6

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' })
  } catch {
    return ''
  }
}

function projectPids(pattern) {
  const pids = []
  const out = run('pgrep', ['-f', pattern])
  for (const pid of out.split('\n').map(Number).filter(Boolean)) {
    const cmdline = run('ps', ['-p', String(pid), '-o', 'command='])
    // Skip our own process tree: the stop script itself may match a pattern.
    if (cmdline.includes('stop.mjs')) continue
    if (!cmdline.includes(PROJECT)) continue
    pids.push(pid)
  }
  return pids
}

function killAll(pids, label) {
  let count = 0
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
      console.log(`killed ${pid} (${label})`)
      count++
    } catch {
      // already gone
    }
  }
  return count
}

let killed = 0

// Round-based sweep: each pass kills whatever is still alive from this
// project; stop when a full pass finds nothing (or rounds run out).
for (let round = 0; round < ROUNDS; round++) {
  let killedThisRound = 0
  for (const pattern of PATTERNS) {
    killedThisRound += killAll(projectPids(pattern), pattern)
  }
  killed += killedThisRound
  if (killedThisRound === 0) break
  await new Promise((resolve) => setTimeout(resolve, 800))
}

// Clear anything still listening on a dev port (respawned listeners, etc).
for (let round = 0; round < 5; round++) {
  let remaining = 0
  for (const port of PORTS) {
    const out = run('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t'])
    for (const pid of out.split('\n').map(Number).filter(Boolean)) {
      try {
        process.kill(pid, 'SIGKILL')
        console.log(`freed port ${port} (pid ${pid})`)
        killed++
        remaining++
      } catch {
        // already gone
      }
    }
  }
  if (remaining === 0) break
  await new Promise((resolve) => setTimeout(resolve, 500))
}

console.log(
  killed > 0 ? `stopped ${killed} process(es).` : 'nothing to stop — all services already down.',
)
