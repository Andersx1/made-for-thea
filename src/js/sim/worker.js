// The drape runner in a background worker: the page stays smooth while the cloth is simulated.
import { createRunner } from './runner.js';

const runner = createRunner((msg, transfer) => postMessage(msg, transfer));
onmessage = (e) => runner.handle(e.data);
