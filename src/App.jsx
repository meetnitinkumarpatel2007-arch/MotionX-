import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from './supabaseClient'
import Auth from './Auth'
import 'leaflet/dist/leaflet.css'

// Custom Emoji Markers (Bulletproof for Vercel)
const emergencyIcon = L.divIcon({
  className: 'custom-icon',
  html: '<div style="font-size: 28px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #dc2626; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🚑</div>',
  iconSize: [46, 46],
  iconAnchor: [23, 46]
});

const privateIcon = L.divIcon({
  className: 'custom-icon',
  html: '<div style="font-size: 28px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #2563eb; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🚘</div>',
  iconSize: [46, 46],
  iconAnchor: [23, 46]
});

// Math function to calculate distance in meters
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
  
  // Routing States
  const [targetHospital, setTargetHospital] = useState(null)
  const [hospitalRoute, setHospitalRoute] = useState(null)
  const [isRouting, setIsRouting] = useState(false)

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

  // Live Tracking Sync
  useEffect(() => {
    if (!session || !myProfile?.lat) return

    const sub = supabase.channel('public:profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        setAllUsers((current) => {
          const exists = current.find(u => u.id === payload.new.id)
          if (exists) return current.map(u => u.id === payload.new.id ? payload.new : u)
          return [...current, payload.new]
        })
      }).subscribe()

    supabase.from('profiles').select('*').then(({ data }) => setAllUsers(data || []))

    return () => { supabase.removeChannel(sub) }
  }, [session, myProfile?.lat])

  // SMART V2X PROXIMITY ALERT (Optimized for dynamic hospitals)
  useEffect(() => {
    if (myProfile?.role !== 'private') return
    const activeAmbulances = allUsers.filter(u => u.role === 'emergency' && u.is_emergency)
    let isDanger = false

    activeAmbulances.forEach(amb => {
      if (amb.lat && amb.lng && myProfile.lat && myProfile.lng) {
        // Triggers flawlessly if any active ambulance is within a 600m radius
        if (getDistance(amb.lat, amb.lng, myProfile.lat, myProfile.lng) <= 600) {
          isDanger = true;
        }
      }
    })

    if (isDanger && !alertActive) {
      const msg = "Ambulance approaching nearby, please clear the overtaking lane immediately."
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg))
      setTimeout(() => {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg))
      }, 4500)
    }
    setAlertActive(isDanger)
  }, [allUsers, myProfile, alertActive])

  // DYNAMIC NEAREST HOSPITAL SCANNER (Overpass API)
  const findNearestHospital = async (lat, lng) => {
    try {
      // Scans an 8000m (8km) radius for the nearest hospital
      const query = `[out:json];node(around:8000,${lat},${lng})["amenity"="hospital"];out 1;`;
      const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      if (data.elements && data.elements.length > 0) {
        const hosp = data.elements[0];
        return { name: hosp.tags?.name || "Nearest Emergency Hospital", coords: [hosp.lat, hosp.lon] };
      }
    } catch (err) {
      console.error("Hospital API Failed", err);
    }
    // Fallback if API fails
    return { name: "Emergency Medical Center (Simulated)", coords: [lat + 0.015, lng + 0.015] };
  }

  // EMERGENCY BUTTON TOGGLE
  const toggleEmergency = async () => {
    const newState = !myProfile.is_emergency
    await supabase.from('profiles').update({ is_emergency: newState }).eq('id', session.user.id)
    setMyProfile({ ...myProfile, is_emergency: newState })
    
    if (newState && myProfile.lat && myProfile.lng) {
      setIsRouting(true)
      const hospital = await findNearestHospital(myProfile.lat, myProfile.lng);
      setTargetHospital(hospital);
    } else {
      setTargetHospital(null);
      setHospitalRoute(null);
      setIsRouting(false);
    }
  }

  // DYNAMIC ROAD ROUTING (Automatically recalculates when GPS moves)
  useEffect(() => {
    if (myProfile?.role === 'emergency' && myProfile?.is_emergency && myProfile?.lat && myProfile?.lng && targetHospital) {
      setIsRouting(true)
      fetch(`https://router.project-osrm.org/route/v1/driving/${myProfile.lng},${myProfile.lat};${targetHospital.coords[1]},${targetHospital.coords[0]}?overview=full&geometries=geojson`)
        .then(res => res.json())
        .then(data => {
          if (data.routes && data.routes[0]) {
            const realRoadCoords = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]])
            setHospitalRoute(realRoadCoords)
          } else {
            setHospitalRoute([[myProfile.lat, myProfile.lng], targetHospital.coords])
          }
          setIsRouting(false)
        })
        .catch(err => {
          console.error("Routing Failed", err)
          setHospitalRoute([[myProfile.lat, myProfile.lng], targetHospital.coords])
          setIsRouting(false)
        })
    }
  }, [myProfile?.lat, myProfile?.lng, myProfile?.is_emergency, targetHospital])

  const enforceProfile = async (latitude, longitude, overrideRole = null) => {
    const activeRole = overrideRole || myProfile?.role || 'emergency'; 
    const plate = myProfile?.plate_number && myProfile.plate_number !== 'UNKNOWN' 
      ? myProfile.plate_number 
      : (activeRole === 'emergency' ? 'AMB-911' : 'GJ-01-XX');
    
    const updatedProfile = { ...myProfile, role: activeRole, plate_number: plate, lat: latitude, lng: longitude };
    setMyProfile(updatedProfile);
    
    if (session?.user?.id) {
      await supabase.from('profiles').upsert({ id: session.user.id, role: activeRole, plate_number: plate, lat: latitude, lng: longitude });
    }
  }

  // FORCE OVERRIDE (Dynamically spawns demo near YOUR location, not just Ahmedabad!)
  const triggerOverride = () => {
    const activeRole = myProfile?.role || 'emergency'; 
    
    // Default to Gandhinagar coords if real GPS hasn't loaded at all
    const baseLat = myProfile?.lat || 23.2156; 
    const baseLng = myProfile?.lng || 72.6369; 

    // Spawns vehicles within 300m of each other so the alert perfectly triggers
    const mockLat = activeRole === 'emergency' ? baseLat + 0.002 : baseLat; 
    const mockLng = activeRole === 'emergency' ? baseLng + 0.002 : baseLng;
    
    enforceProfile(mockLat, mockLng);
  }

  const forceRealGPS = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => enforceProfile(pos.coords.latitude, pos.coords.longitude),
      (err) => alert("GPS Error: " + err.message),
      { enableHighAccuracy: true, timeout: 30000 }
    )
  }

  if (!session) return <Auth onLogin={(user) => { setSession({ user }); fetchProfile(user.id); }} />
  
  if (!myProfile?.lat) return (
    <div className="flex flex-col h-screen items-center justify-center bg-gray-100 text-gray-800 font-sans gap-4 p-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-600 mb-2"></div>
      <div className="text-xl font-bold">Acquiring Secure V2X Network...</div>
      <button onClick={forceRealGPS} className="w-full max-w-sm mt-4 px-6 py-4 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-xl">
        ALLOW LOCATION (REAL GPS)
      </button>
      <p className="text-gray-500 font-bold text-sm my-2">OR</p>
      <button onClick={triggerOverride} className="w-full max-w-sm px-6 py-4 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 shadow-xl">
        FORCE OVERRIDE (DEMO MAP)
      </button>
    </div>
  )

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      
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
            {isRouting ? 'SCANNING FOR NEAREST HOSPITAL...' : (myProfile.is_emergency && targetHospital ? `ROUTING TO: ${targetHospital.name.toUpperCase()}` : 'STANDBY MODE')}
          </p>
          <button 
            onClick={toggleEmergency}
            disabled={isRouting}
            className={`w-full py-4 text-xl font-extrabold rounded-xl transition-all shadow-lg text-white ${myProfile.is_emergency ? 'bg-gray-800 hover:bg-gray-900' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {myProfile.is_emergency ? 'DEACTIVATE EMERGENCY' : 'ACTIVATE EMERGENCY ROUTE'}
          </button>
        </div>
      )}

      {/* LEAFLET MAP */}
      <MapContainer center={[myProfile.lat, myProfile.lng]} zoom={14} style={{ height: '100%', width: '100%', zIndex: 1 }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        
        {/* Real GPS Live-Updating Road Route */}
        {hospitalRoute && myProfile.role === 'emergency' && (
          <Polyline positions={hospitalRoute} color="#dc2626" weight={8} opacity={0.8} />
        )}

        {/* Dynamic Target Hospital Marker */}
        {myProfile.is_emergency && targetHospital && (
          <Marker position={targetHospital.coords}>
            <Popup><strong>{targetHospital.name}</strong></Popup>
          </Marker>
        )}

        {/* YOUR OWN MARKER */}
        <Marker position={[myProfile.lat, myProfile.lng]} icon={myProfile.role === 'emergency' ? emergencyIcon : privateIcon}>
          <Popup><strong>{myProfile.plate_number} (YOU)</strong></Popup>
        </Marker>
        
        {/* OTHER VEHICLES MARKERS */}
        {allUsers.filter(u => u.id !== session.user.id).map(user => (
          user.lat && user.lng && (
            <Marker key={user.id} position={[user.lat, user.lng]} icon={user.role === 'emergency' ? emergencyIcon : privateIcon}>
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