import '@/assets/page.css';
import './style.css';
import { render } from 'preact';
import { Library } from '@/components/Library';

function Options() {
  return (
    <main>
      <h1>Code Walkthroughs</h1>
      <p class="muted">
        Audio walkthroughs of code, played on GitHub. Each walkthrough is a folder with a <code>walkthrough.json</code> and one MP3
        per slide, written by the code-walkthrough Claude skill. Start one here or from the toolbar icon. A player appears on
        GitHub; drag it anywhere.
      </p>
      <Library mode="options" />
    </main>
  );
}

render(<Options />, document.getElementById('app')!);
