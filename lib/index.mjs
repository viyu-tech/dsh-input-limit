//#region src/index.ts
/**
* Host half of dsh-input-limit. The browser UI lives in `./client`; this
* package's presence as a loader entry is what makes the Host serve the client
* bundle and the browser execute it, so this half carries no behavior.
*/
const name = "dsh-input-limit";
function apply() {}
//#endregion
export { apply, name };
