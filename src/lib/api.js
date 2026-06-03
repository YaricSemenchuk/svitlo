// Клієнт auth-API. Токен зберігаємо в localStorage.
const TOKEN_KEY = 'svitlo.token'

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Помилка сервера')
  return data
}

export const apiRegister = (payload) => call('/register', { method: 'POST', body: payload })
export const apiLogin = (payload) => call('/login', { method: 'POST', body: payload })
export const apiMe = (token) => call('/me', { token })
export const apiUpdateProfile = (token, role, profile) =>
  call('/profile', { method: 'PUT', token, body: { role, profile } })
