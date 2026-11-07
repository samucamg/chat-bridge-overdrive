// Executor de testes independente de shell e de versao do Node.
// Motivo: `node --test tests/*.test.mjs` depende do shell expandir o asterisco. No Windows
// (cmd.exe) com Node 20 isso falha com "Could not find". Aqui a lista de arquivos e montada
// em JavaScript e passada explicitamente ao `node --test`.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(dir, name));

if (files.length === 0) {
  console.error('Nenhum arquivo *.test.mjs encontrado em ' + dir);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
