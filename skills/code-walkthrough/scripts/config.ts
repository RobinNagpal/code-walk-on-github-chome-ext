// Reads or writes the skill's settings: the walkthroughs folder and the voice.
//
//   node config.ts get                                    prints the folder; exits 1 if not configured
//   node config.ts set <folder>                           stores the folder (created if missing)
//   node config.ts voice                                  prints the voice settings as JSON
//   node config.ts models                                 lists providers, their models and API keys
//   node config.ts set-voice <edge|openai|gemini> [voice|-] [model]
//   node config.ts path                                   prints where the config file lives
//
// CODE_WALKTHROUGHS_DIR overrides the stored folder.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKey, isProvider, missingKeyMessage, PROVIDERS, type VoiceSettings } from './tts.ts';

export const CONFIG_FILE = join(homedir(), '.config', 'code-walkthroughs', 'config.json');

interface Config {
  walkthroughsDir?: string;
  voice?: VoiceSettings;
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

export function readConfig(): Config {
  return existsSync(CONFIG_FILE) ? (JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Config) : {};
}

function writeConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function voiceSettings(): VoiceSettings {
  return readConfig().voice ?? { provider: 'edge' };
}

function main(args: string[]): void {
  const [command, ...rest] = args;
  switch (command) {
    case 'get': {
      const dir = process.env.CODE_WALKTHROUGHS_DIR ? expandHome(process.env.CODE_WALKTHROUGHS_DIR) : readConfig().walkthroughsDir;
      if (!dir) {
        console.error(`Not configured. Run: node config.ts set <folder>  (config file: ${CONFIG_FILE})`);
        process.exit(1);
      }
      if (!existsSync(dir)) {
        console.error(`Configured folder does not exist: ${dir}`);
        process.exit(1);
      }
      console.log(dir);
      return;
    }
    case 'set': {
      if (!rest[0]) {
        console.error('Usage: node config.ts set <folder>');
        process.exit(2);
      }
      const dir = resolve(expandHome(rest[0]));
      mkdirSync(dir, { recursive: true });
      writeConfig({ ...readConfig(), walkthroughsDir: dir });
      console.log(`Code walkthroughs folder set to ${dir}`);
      return;
    }
    case 'voice': {
      const voice = voiceSettings();
      const { voice: defaultVoice, model: defaultModel, keys } = PROVIDERS[voice.provider];
      const key = keys.length === 0 || apiKey(voice.provider) ? 'ok' : missingKeyMessage(voice.provider);
      console.log(JSON.stringify({ provider: voice.provider, voice: voice.voice ?? defaultVoice, model: voice.model ?? defaultModel, apiKey: key }));
      return;
    }
    case 'models':
      for (const [name, provider] of Object.entries(PROVIDERS)) {
        const models = provider.models ? provider.models.join(', ') : '(no model choice)';
        console.log(`${name.padEnd(7)} key: ${provider.keys.join(' or ') || 'none'}  models: ${models}  default voice: ${provider.voice}`);
      }
      return;
    case 'set-voice': {
      // "-" keeps the provider's default voice, so a model can be set alone: set-voice gemini - <model>
      const [provider, voice, model] = rest.map((v) => (v === '-' ? undefined : v));
      if (!provider || !isProvider(provider)) {
        console.error(`Usage: node config.ts set-voice <${Object.keys(PROVIDERS).join('|')}> [voice|-] [model]`);
        process.exit(2);
      }
      const known = PROVIDERS[provider].models;
      if (model && known && !known.includes(model)) console.warn(`Note: ${model} is not one of the known ${provider} models (${known.join(', ')}); using it anyway.`);
      writeConfig({ ...readConfig(), voice: { provider, voice: voice || undefined, model: model || undefined } });
      const chosen = [voice ?? PROVIDERS[provider].voice, model ?? PROVIDERS[provider].model].filter(Boolean).join(', ');
      console.log(`Voice set to ${provider} (${chosen})`);
      if (PROVIDERS[provider].keys.length && !apiKey(provider)) console.warn(missingKeyMessage(provider));
      return;
    }
    case 'path':
      console.log(CONFIG_FILE);
      return;
    default:
      console.error('Usage: node config.ts get | set <folder> | voice | models | set-voice <provider> [voice|-] [model] | path');
      process.exit(2);
  }
}

// Run only when executed directly, not when imported by generate-audio.ts. The skill is
// usually installed as a symlink, and import.meta.url is the resolved path, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
