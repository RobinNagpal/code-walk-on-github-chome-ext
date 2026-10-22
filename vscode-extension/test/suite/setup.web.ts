// Mocha's browser build defines describe/it globally; the suites need them as they load.
import 'mocha/mocha.js';

mocha.setup({ ui: 'bdd', reporter: undefined, timeout: 90_000 });
