// Підписка на Web Push: дозвіл → підписка через VAPID → відправка на сервер.
// Працює на Android/desktop у браузері; на iOS — лише для PWA, доданої на
// початковий екран (iOS 16.4+). Викликати з користувацького жесту (тап).
import { apiVapid, apiSubscribePush, getToken } from './api'

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export async function ensurePushSubscription() {
  try {
    const token = getToken()
    if (!token) return false
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    if (Notification.permission === 'denied') return false

    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return false
    }

    const { publicKey } = await apiVapid()
    if (!publicKey) return false

    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
    }
    await apiSubscribePush(token, sub)
    return true
  } catch {
    return false
  }
}
