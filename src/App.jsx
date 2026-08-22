import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from './supabaseClient'
import Auth from './Auth'
import 'leaflet/dist/leaflet.css'

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

let DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
})
L.Marker.prototype.options.icon = DefaultIcon

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3
  const p1 = lat1 * Math.PI / 180
  const p2 = lat2 * Math.PI / 180
  const dp = (lat2 - lat1) * Math.PI / 180
  const dl = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export default function App() {
  const [session, setSession] = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [allUsers, setAllUsers] = useState([])
  const [alertActive, setAlertActive] = useState(false)
  const [hospitalRoute, setHospitalRoute] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
    })
  }, [])

  const fetchProfile = async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) setMyProfile(data)
  }

  // Live Tracking Sync - UPGRADED FOR MOBILE GPS
  useEffect(() => {
    if (!session || !myProfile) return

    const handleSuccess = async (pos) => {
      const { latitude, longitude } = pos.coords
      setMyProfile(prev => ({ ...prev, lat: latitude, lng: longitude }))
      await supabase.from('profiles').update({ lat: latitude, lng: longitude }).eq('id', session.user.id)
    }

    // Increased timeout to 30 seconds and allowed cached locations to help mobile phones load faster
    const watchId = navigator.geolocation.watchPosition(
      handleSuccess, 
      (err) => console.warn("GPS Warning:", err.message), 
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 }
    )

    const sub = supabase.channel('public:profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        setAllUsers((current) => {
          const exists = current.find(u => u.id === payload.new.id)
          if (exists) return current.map(u => u.id === payload.new.id ? payload.new : u)
          return [...current, payload.new]
        })
      }).subscribe()

    supabase.from('profiles').select('*').then(({ data }) => setAllUsers(data || []))

    return () => {
      navigator.geolocation.clearWatch(watchId)
      supabase.removeChannel(sub)
    }
  }, [session, myProfile?.id])

  // V2X Proximity Alert & Double Voice Command
  useEffect(() => {
    if (myProfile?.role !== 'private') return
    const activeAmbulances = allUsers.filter(u => u.role === 'emergency' && u.is_emergency)
    let isDanger = false

    activeAmbulances.forEach(amb => {
      if (amb.lat && amb.lng && myProfile.lat && myProfile.lng) {
        if (getDistance(myProfile.lat, myProfile.lng, amb.lat, amb.lng) < 600) isDanger = true
      }
    })

    if (isDanger && !alertActive) {
      const msg = "Ambulance approaching, please clear overtaking lane."
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg))
      setTimeout(() => {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg))
      }, 3500)
    }
    setAlertActive(isDanger)
  }, [allUsers, myProfile, alertActive])

  // Hospital Routing Button
  const toggleEmergency = async () => {
    const newState = !myProfile.is_emergency
    await supabase.from('profiles').update({ is_emergency: newState }).eq('id', session.user.id)
    setMyProfile({ ...myProfile, is_emergency: newState })
    
    // Sola Civil Hospital Coordinates
    const SOLA_HOSPITAL_COORDS = [23.0785, 72.5285];
    setHospitalRoute(newState && myProfile.lat ? [[myProfile.lat, myProfile.lng], SOLA_HOSPITAL_COORDS] : null)
  }

  const triggerOverride = async () => {
    const activeRole = myProfile?.role || 'emergency'; 
    const mockLat = activeRole === 'emergency' ? 23.0650 : 23.0625; 
    const mockLng = activeRole === 'emergency' ? 72.5350 : 72.5314;
    
    const updatedProfile = { 
      ...myProfile, 
      role: activeRole, 
      plate_number: myProfile?.plate_number || (activeRole === 'emergency' ? 'AMB-911' : 'GJ-01-XX'),
      lat: mockLat, 
      lng: mockLng 
    };
    
    setMyProfile(updatedProfile);
    
    if (session?.user?.id) {
      await supabase.from('profiles').upsert({ 
        id: session.user.id, 
        role: activeRole,
        plate_number: updatedProfile.plate_number,
        lat: mockLat, 
        lng: mockLng 
      });
    }
  }

  // Manual GPS Trigger for stubborn mobile browsers
  const forceRealGPS = () => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setMyProfile(prev => ({ ...prev, lat: latitude, lng: longitude }));
        await supabase.from('profiles').update({ lat: latitude, lng: longitude }).eq('id', session.user.id);
      },
      (err) => alert("GPS Failed: " + err.message + " - Please ensure Location Services are enabled in your phone settings."),
      { enableHighAccuracy: true, timeout: 30000 }
    )
  }

  if (!session) return <Auth onLogin={(user) => { setSession({ user }); fetchProfile(user.id); }} />
  
  if (!myProfile?.lat) return (
    <div className="flex flex-col h-screen items-center justify-center bg-gray-100 text-gray-800 font-sans gap-4 p-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-600 mb-2"></div>
      <div className="text-xl font-bold">Acquiring Secure V2X Network...</div>
      
      <button onClick={forceRealGPS} className="w-full max-w-sm mt-4 px-6 py-4 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-xl cursor-pointer">
        ALLOW LOCATION (REAL GPS)
      </button>
      
      <p className="text-gray-500 font-bold text-sm my-2">OR</p>

      <button onClick={triggerOverride} className="w-full max-w-sm px-6 py-4 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 shadow-xl cursor-pointer">
        FORCE OVERRIDE (DEMO MAP)
      </button>
    </div>
  )

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* ... [Rest of the return statement remains exactly the same] ... */}
      
      {/* PRIVATE DASHBOARD */}
      {myProfile.role === 'private' && (
        <>
          <div className="absolute top-6 left-6 z-[999] bg-white p-4 rounded-xl shadow-xl border-l-4 border-blue-600">
            <h2 className="font-black text-gray-900 text-lg">PRIVATE DASHBOARD</h2>
            <p className="text-gray-600 font-mono text-sm mt-1 uppercase">Plate: {myProfile.plate_number}</p>
          </div>
          {alertActive && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[999] bg-red-600 text-white p-6 rounded-xl shadow-2xl animate-pulse text-2xl font-black border-4 border-yellow-400 text-center w-[90%] max-w-lg">
              🚨 AMBULANCE APPROACHING 🚨 <br/> Clear Overtaking Lane!
            </div>
          )}
        </>
      )}

      {/* EMERGENCY DASHBOARD */}
      {myProfile.role === 'emergency' && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[999] bg-white p-6 rounded-2xl shadow-2xl w-[90%] max-w-lg text-center border-t-4 border-red-600">
          <h2 className="font-black text-gray-900 text-2xl mb-1 uppercase">UNIT: {myProfile.plate_number}</h2>
          <p className={`font-bold mb-4 ${myProfile.is_emergency ? 'text-red-600 animate-pulse' : 'text-gray-500'}`}>
            {myProfile.is_emergency ? 'ROUTING TO SOLA CIVIL HOSPITAL...' : 'STANDBY MODE'}
          </p>
          <button 
            onClick={toggleEmergency}
            className={`w-full py-4 text-xl font-extrabold rounded-xl transition-all shadow-lg text-white cursor-pointer ${myProfile.is_emergency ? 'bg-gray-800 hover:bg-gray-900' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {myProfile.is_emergency ? 'DEACTIVATE EMERGENCY' : 'ACTIVATE EMERGENCY ROUTE'}
          </button>
        </div>
      )}

      {/* LEAFLET MAP */}
      <MapContainer center={[myProfile.lat, myProfile.lng]} zoom={14} style={{ height: '100%', width: '100%', zIndex: 1 }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        
        {/* Hospital Route Line */}
        {hospitalRoute && myProfile.role === 'emergency' && (
          <Polyline positions={hospitalRoute} color="#dc2626" weight={8} opacity={0.8} dashArray="10, 10" />
        )}
        
        {allUsers.map(user => (
          user.lat && user.lng && (
            <Marker key={user.id} position={[user.lat, user.lng]}>
              <Popup>
                <div className="text-center">
                  <strong className="text-lg uppercase">{user.plate_number}</strong><br/>
                  <span className="uppercase text-xs font-bold text-gray-500">{user.role}</span> <br/>
                  {user.is_emergency && <span className="text-red-600 font-bold">🚨 EMERGENCY</span>}
                </div>
              </Popup>
            </Marker>
          )
        ))}
      </MapContainer>
    </div>
  )
}