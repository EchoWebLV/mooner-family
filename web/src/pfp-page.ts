// Draws Mooner pictures for the phone app, which loads this page in a hidden WebView:
// the app posts { id, wallet, pfp | null, px }, the page answers { id, png } (a data URL)
// or { id, error }. A wallet with no saved picture gets its default (handlePfp), as on the
// web. renderPfp draws one picture at a time (its own queue), so asks may overlap.
import { renderPfp } from './lib/pfp/render'
import { handlePfp, sanitizePfp } from './lib/pfp/traits'

type Ask = { id: string; wallet: string; pfp: unknown; px: number }
type RNWindow = Window & { ReactNativeWebView?: { postMessage(s: string): void } }

const reply = (msg: object) => (window as RNWindow).ReactNativeWebView?.postMessage(JSON.stringify(msg))

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

async function draw(ask: Ask) {
  try {
    const pfp = ask.pfp ? sanitizePfp(ask.pfp) : handlePfp(ask.wallet)
    reply({ id: ask.id, png: await toDataUrl(await renderPfp(pfp, ask.px)) })
  } catch (e) {
    reply({ id: ask.id, error: e instanceof Error ? e.message : String(e) })
  }
}

function onMessage(e: MessageEvent) {
  let ask: Ask
  try {
    ask = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
  } catch {
    return
  }
  if (ask?.id && ask.wallet && [128, 256, 512].includes(ask.px)) draw(ask)
}

// react-native-webview delivers postMessage on window and on document, depending on platform
window.addEventListener('message', onMessage)
document.addEventListener('message', onMessage as EventListener)
reply({ ready: true })
