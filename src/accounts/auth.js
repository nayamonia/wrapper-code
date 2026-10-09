import { spawn } from 'node:child_process';

// Login and logout always go through Claude Code itself; wrapper-code never touches the
// stored credentials. Resolves { code } and never rejects.
export function runAuth(sub, { claudePath, configDir, env, inherit = false, timeoutMs, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(claudePath, ['auth', sub], { env: { ...env, CLAUDE_CONFIG_DIR: configDir }, stdio: inherit ? 'inherit' : 'ignore' });
    } catch (error) {
      resolve({ code: 1, error });
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish({ code: 1, timedOut: true });
      }, timeoutMs);
    }
    child.on('error', (error) => finish({ code: 1, error }));
    child.on('exit', (code) => finish({ code: code ?? 1 }));
  });
}
