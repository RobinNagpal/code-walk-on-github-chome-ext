import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({ plugins: [preact()] }),
  manifest: {
    name: 'Code Walkthroughs',
    description: 'Play audio code walkthroughs on GitHub, pinned to a commit.',
    permissions: ['storage', 'offscreen', 'tabs', 'tts'],
    host_permissions: ['https://github.com/*'],
    action: { default_title: 'Code Walkthroughs' },
  },
});
