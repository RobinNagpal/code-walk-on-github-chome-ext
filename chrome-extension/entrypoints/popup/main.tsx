import '@/assets/page.css';
import './style.css';
import { render } from 'preact';
import { browser } from 'wxt/browser';
import { Library } from '@/components/Library';

function Popup() {
  return (
    <>
      <div class="topbar">
        <h1>Code Walkthroughs</h1>
        <button class="link" onClick={() => (browser.runtime.openOptionsPage(), window.close())}>
          Settings
        </button>
      </div>
      <Library mode="popup" />
    </>
  );
}

render(<Popup />, document.getElementById('app')!);
