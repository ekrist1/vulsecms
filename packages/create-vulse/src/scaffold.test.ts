import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffold } from './scaffold.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'create-vulse-'));
}

function templateDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'create-vulse-tmpl-'));
  for (const [path, body] of Object.entries(files)) {
    const fullPath = join(dir, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, body);
  }
  return dir;
}

describe('scaffold', () => {
  it('copies every file from template into the target directory', async () => {
    const target = tempProject();
    const template = templateDir({
      'package.json.tmpl': '{ "name": "__PROJECT_NAME__" }',
      'vulse.config.ts': 'export default {};',
    });

    await scaffold({ target, template, projectName: 'my-app' });

    const targetFiles = readdirSync(target).sort();
    expect(targetFiles).toContain('package.json');
    expect(targetFiles).toContain('vulse.config.ts');
    expect(readFileSync(join(target, 'package.json'), 'utf8')).toBe('{ "name": "my-app" }');
  });

  it('refuses to scaffold into a non-empty directory unless force is set', async () => {
    const target = tempProject();
    writeFileSync(join(target, 'existing.txt'), 'hi');
    const template = templateDir({ 'package.json.tmpl': '{}' });

    await expect(scaffold({ target, template, projectName: 'x' })).rejects.toThrow(/not empty/);

    await scaffold({ target, template, projectName: 'x', force: true });
    expect(statSync(join(target, 'package.json')).isFile()).toBe(true);
  });

  it('substitutes __PROJECT_NAME__ in any .tmpl file', async () => {
    const target = tempProject();
    const template = templateDir({
      'README.md.tmpl': '# __PROJECT_NAME__\n\nA Vulse project.',
    });
    await scaffold({ target, template, projectName: 'fancy-app' });
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('# fancy-app\n\nA Vulse project.');
  });
});
