import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Download, Share, Smartphone } from 'lucide-react'
import { Btn } from './ui'

// Встановлення PWA: кнопка beforeinstallprompt (Android/desktop),
// банер-підказка для iOS, і QR з origin для роздачі застосунку.
export default function InstallQR() {
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(false)
  const url = typeof window !== 'undefined' ? window.location.origin : ''
  const isIOS =
    typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault()
      setDeferred(e)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }

  return (
    <div className="install">
      <div className="tag">// встановити на телефон</div>

      {!installed && deferred && (
        <Btn variant="primary" onClick={install}>
          <Download size={16} /> Встановити застосунок
        </Btn>
      )}

      {!installed && isIOS && !deferred && (
        <div className="ios-hint">
          <Share size={13} style={{ verticalAlign: '-2px' }} /> Поділитися →
          <br />
          «На початковий екран» <Smartphone size={13} style={{ verticalAlign: '-2px' }} />
        </div>
      )}

      {installed && <div className="ios-hint lime">✓ Застосунок встановлено</div>}

      <div className="qr-box">
        <QRCodeSVG value={url} size={148} bgColor="#ffffff" fgColor="#08080a" level="M" />
      </div>
      <div className="ios-hint" style={{ textAlign: 'center', wordBreak: 'break-all' }}>
        {url}
      </div>
    </div>
  )
}
