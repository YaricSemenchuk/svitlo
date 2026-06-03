import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { TripProvider, useTrip } from './state/TripContext'

import Home from './screens/Home'
import Register from './screens/Register'
import Login from './screens/Login'
import Order from './screens/rider/Order'
import Matching from './screens/rider/Matching'
import EnRoute from './screens/rider/EnRoute'
import RiderTrip from './screens/rider/Trip'
import Complete from './screens/rider/Complete'

import Online from './screens/driver/Online'
import Request from './screens/driver/Request'
import Navigate2 from './screens/driver/Navigate'
import DriverTrip from './screens/driver/Trip'

// Читаємо ?ref= з QR-атрибуції водія один раз на старті.
function RefReader() {
  const { dispatch } = useTrip()
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref) dispatch({ type: 'SET_REF', ref })
  }, [dispatch])
  return null
}

export default function App() {
  return (
    <TripProvider>
      <BrowserRouter>
        <RefReader />
        <div className="app">
          <Routes>
            <Route path="/" element={<Home />} />

            <Route path="/login" element={<Login />} />
            <Route path="/register/rider" element={<Register role="rider" />} />
            <Route path="/register/driver" element={<Register role="driver" />} />

            <Route path="/rider/order" element={<Order />} />
            <Route path="/rider/matching" element={<Matching />} />
            <Route path="/rider/enroute" element={<EnRoute />} />
            <Route path="/rider/trip" element={<RiderTrip />} />
            <Route path="/rider/complete" element={<Complete />} />

            <Route path="/driver/online" element={<Online />} />
            <Route path="/driver/request" element={<Request />} />
            <Route path="/driver/navigate" element={<Navigate2 />} />
            <Route path="/driver/trip" element={<DriverTrip />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </TripProvider>
  )
}
