import { describe, expect, it } from 'vitest';
import { renderPlist } from '../../src/service/index.js';

describe('renderPlist', () => {
  it('embeds ProgramArguments as [nodePath, cliJsPath, "start"]', () => {
    const xml = renderPlist({
      label: 'com.gearbox.proxy',
      nodePath: '/usr/local/bin/node',
      cliJsPath: '/opt/gearbox/dist/cli.js',
      logDir: '/Users/me/.gearbox/logs',
    });

    expect(xml).toContain('<key>ProgramArguments</key>');
    const argsBlock = xml.slice(xml.indexOf('<array>'), xml.indexOf('</array>') + '</array>'.length);
    expect(argsBlock).toContain('<string>/usr/local/bin/node</string>');
    expect(argsBlock).toContain('<string>/opt/gearbox/dist/cli.js</string>');
    expect(argsBlock).toContain('<string>start</string>');
  });

  it('sets RunAtLoad and KeepAlive to true', () => {
    const xml = renderPlist({
      label: 'com.gearbox.proxy',
      nodePath: '/usr/local/bin/node',
      cliJsPath: '/opt/gearbox/dist/cli.js',
      logDir: '/Users/me/.gearbox/logs',
    });

    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it('points StandardOutPath and StandardErrorPath at logDir/gearbox.{log,err.log}', () => {
    const xml = renderPlist({
      label: 'com.gearbox.proxy',
      nodePath: '/usr/local/bin/node',
      cliJsPath: '/opt/gearbox/dist/cli.js',
      logDir: '/Users/me/.gearbox/logs',
    });

    expect(xml).toContain('<key>StandardOutPath</key>\n\t<string>/Users/me/.gearbox/logs/gearbox.log</string>');
    expect(xml).toContain('<key>StandardErrorPath</key>\n\t<string>/Users/me/.gearbox/logs/gearbox.err.log</string>');
  });

  it('includes the Label', () => {
    const xml = renderPlist({
      label: 'com.gearbox.proxy',
      nodePath: '/usr/local/bin/node',
      cliJsPath: '/opt/gearbox/dist/cli.js',
      logDir: '/Users/me/.gearbox/logs',
    });

    expect(xml).toContain('<key>Label</key>\n\t<string>com.gearbox.proxy</string>');
  });

  it('produces well-formed, parseable XML', () => {
    const xml = renderPlist({
      label: 'com.gearbox.proxy',
      nodePath: '/usr/local/bin/node',
      cliJsPath: '/opt/gearbox/dist/cli.js',
      logDir: '/Users/me/.gearbox/logs',
    });

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<plist version="1.0">');
    expect(xml).toContain('</plist>');
    // Balanced <dict>/</dict>
    expect((xml.match(/<dict>/g) ?? []).length).toBe((xml.match(/<\/dict>/g) ?? []).length);
  });

  it('XML-escapes paths containing spaces and ampersands', () => {
    const xml = renderPlist({
      label: 'com.gearbox.proxy',
      nodePath: '/usr/local/bin/node',
      cliJsPath: '/Users/me/My Projects & Stuff/dist/cli.js',
      logDir: '/Users/me/.gearbox/logs',
    });

    expect(xml).toContain('<string>/Users/me/My Projects &amp; Stuff/dist/cli.js</string>');
    // Raw unescaped ampersand must never appear.
    expect(xml).not.toContain('Projects & Stuff');
  });

  it('XML-escapes angle brackets and quotes in values', () => {
    const xml = renderPlist({
      label: 'com.gearbox.proxy',
      nodePath: '/usr/local/bin/node',
      cliJsPath: '/opt/<weird>"path"/cli.js',
      logDir: '/Users/me/.gearbox/logs',
    });

    expect(xml).toContain('&lt;weird&gt;&quot;path&quot;');
    expect(xml).not.toContain('<weird>');
  });
});
