import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from './supabaseClient'
import Auth from './Auth'
import DashcamAI from './DashcamAI'
import Peer from 'peerjs'
import 'leaflet/dist/leaflet.css'

const emergencyIcon = L.divIcon({ className: 'custom-icon', html: '<div style="font-size: 28px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #dc2626; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🚑</div>', iconSize: [46, 46], iconAnchor: [23, 46]});
const privateIcon = L.divIcon({ className: 'custom-icon', html: '<div style="font-size: 28px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #2563eb; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🚘</div>', iconSize: [46, 46], iconAnchor: [23, 46]});
const fleetIcon = L.divIcon({ className: 'custom-icon', html: '<div style="font-size: 28px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #9333ea; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🏢</div>', iconSize: [46, 46], iconAnchor: [23, 46]});
const familyIcon = L.divIcon({ className: 'custom-icon', html: '<div style="font-size: 28px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #22c55e; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">📍</div>', iconSize: [46, 46], iconAnchor: [23, 46]});

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; const p1 = lat1 * Math.PI / 180; const p2 = lat2 * Math.PI / 180; const dp = (lat2 - lat1) * Math.PI / 180; const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function App() {
  const [session, setSession] = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [allUsers, setAllUsers] = useState([])
  const [v2xWarningLevel, setV2xWarningLevel] = useState(0) // 0: Safe, 1: 1000m, 2: 50m
  
  const [targetHospital, setTargetHospital] = useState(null)
  const [hospitalRoute, setHospitalRoute] = useState(null)
  const [isRouting, setIsRouting] = useState(false)
  
  const [showSosModal, setShowSosModal] = useState(false)
  const [sosEmailInput, setSosEmailInput] = useState("")
  
  const [linkedDriver, setLinkedDriver] = useState(null)
  const remoteVideoRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
    })
  }, [])

  const fetchProfile = async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (data) setMyProfile(data)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  }

  useEffect(() => {
    if (!session || !myProfile?.lat) return
    const sub = supabase.channel('public:profiles').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        setAllUsers((current) => {
          const exists = current.find(u => u.id === payload.new.id)
          if (exists) return current.map(u => u.id === payload.new.id ? payload.new : u)
          return [...current, payload.new]
        })
      }).subscribe()
    supabase.from('profiles').select('*').then(({ data }) => setAllUsers(data || []))
    return () => supabase.removeChannel(sub)
  }, [session, myProfile?.lat])

  // DUAL-STAGE V2X PROXIMITY ALERT
  useEffect(() => {
    if (myProfile?.role !== 'private' && myProfile?.role !== 'fleet') return
    const activeAmbulances = allUsers.filter(u => u.role === 'emergency' && u.is_emergency)
    
    let currentWarningLevel = 0; // Default Safe

    activeAmbulances.forEach(amb => {
      if (amb.lat && amb.lng && myProfile.lat && myProfile.lng) {
        const dist = getDistance(amb.lat, amb.lng, myProfile.lat, myProfile.lng);
        if (dist <= 50) currentWarningLevel = 2; // Critical Imminent (50m)
        else if (dist <= 1000 && currentWarningLevel < 2) currentWarningLevel = 1; // Approaching (1000m)
      }
    })

    if (currentWarningLevel > 0 && v2xWarningLevel === 0) {
      const msg = currentWarningLevel === 2 
        ? "Ambulance Imminent. Pull over immediately." 
        : "Please clear overtaking lane, ambulance is arriving.";
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg))
    }
    setV2xWarningLevel(currentWarningLevel)
  }, [allUsers, myProfile, v2xWarningLevel])

  const findNearestHospital = async (lat, lng) => {
    try {
      const query = `[out:json];node(around:8000,${lat},${lng})["amenity"="hospital"];out 1;`;
      const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.elements && data.elements.length > 0) return { name: data.elements[0].tags?.name || "Nearest Hospital", coords: [data.elements[0].lat, data.elements[0].lon] };
    } catch (err) { }
    return { name: "Emergency Medical Center", coords: [lat + 0.015, lng + 0.015] };
  }

  const toggleEmergency = async () => {
    const newState = !myProfile.is_emergency
    await supabase.from('profiles').update({ is_emergency: newState }).eq('id', session.user.id)
    setMyProfile({ ...myProfile, is_emergency: newState })
    if (newState && myProfile.lat && myProfile.lng) {
      setIsRouting(true)
      const hospital = await findNearestHospital(myProfile.lat, myProfile.lng);
      setTargetHospital(hospital);
    } else {
      setTargetHospital(null); setHospitalRoute(null); setIsRouting(false);
    }
  }

  const enforceProfile = async (lat, lng) => {
    const updatedProfile = { ...myProfile, lat, lng };
    setMyProfile(updatedProfile);
    if (session?.user?.id) await supabase.from('profiles').update({ lat, lng }).eq('id', session.user.id);
  }

  const triggerOverride = () => enforceProfile((myProfile?.lat || 23.0625) + 0.002, (myProfile?.lng || 72.5314) + 0.002);
  const forceRealGPS = () => navigator.geolocation.getCurrentPosition(pos => enforceProfile(pos.coords.latitude, pos.coords.longitude), err => alert(err.message), { enableHighAccuracy: true, timeout: 30000 });

  // MANUAL VOICE TEST FUNCTION
  const testVoiceAlert = () => {
    window.speechSynthesis.speak(new SpeechSynthesisUtterance("Please clear overtaking lane, ambulance is arriving."));
  };

  useEffect(() => {
    if (myProfile?.role === 'family' && session?.user?.email) {
      const fetchDriver = async () => {
        const { data } = await supabase.from('profiles').select('*').eq('sos_email', session.user.email).maybeSingle();
        if (data) setLinkedDriver(data);
      }
      fetchDriver();
      const interval = setInterval(fetchDriver, 3000);
      return () => clearInterval(interval);
    }
  }, [myProfile?.role, session?.user?.email])

  useEffect(() => {
    if (myProfile?.role !== 'family' || !linkedDriver?.id) return;
    const peer = new Peer({ config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }});
    peer.on('open', () => {
      const canvas = document.createElement('canvas');
      const dummyStream = canvas.captureStream(1);
      const call = peer.call(`motionx-driver-${linkedDriver.id}`, dummyStream);
      call.on('stream', (remoteStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          remoteVideoRef.current.play().catch(e => console.log(e));
        }
      });
    });
    return () => peer.destroy();
  }, [myProfile?.role, linkedDriver?.id]);

  if (!session) return <Auth onLogin={(user, localProfile) => { 
    setSession({ user }); 
    if (localProfile) setMyProfile(localProfile);
    fetchProfile(user.id); 
  }} />
  
  if (!myProfile) return (
    <div className="flex flex-col h-screen items-center justify-center bg-gray-900 text-white font-sans gap-4 p-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-500 mb-2"></div>
      <div className="text-xl font-bold tracking-widest uppercase">Loading Secure Profile...</div>
      <button onClick={handleLogout} className="mt-4 px-6 py-3 bg-red-600 rounded font-bold shadow-lg hover:bg-red-700 cursor-pointer">FORCE LOGOUT / RETRY</button>
    </div>
  )
  
  if (!myProfile.lat && myProfile.role !== 'family') return (
    <div className="flex flex-col h-screen items-center justify-center bg-gray-100 text-gray-800 gap-4 p-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-600 mb-2"></div>
      <div className="text-xl font-bold">Acquiring Secure V2X Network...</div>
      <button onClick={forceRealGPS} className="w-full max-w-sm mt-4 px-6 py-4 bg-blue-600 text-white rounded-lg font-bold shadow-xl cursor-pointer">ALLOW LOCATION (REAL GPS)</button>
      <p className="text-gray-500 font-bold">OR</p>
      <button onClick={triggerOverride} className="w-full max-w-sm px-6 py-4 bg-red-600 text-white rounded-lg font-bold shadow-xl cursor-pointer">FORCE OVERRIDE (DEMO MAP)</button>
      <button onClick={handleLogout} className="mt-6 text-sm font-bold text-red-600 underline cursor-pointer">Log Out</button>
    </div>
  )

  if (myProfile.role === 'family') {
    const isDanger = linkedDriver?.ai_status === 'DROWSY' || linkedDriver?.ai_status === 'PHONE DETECTED';
    return (
      <div className="h-screen w-screen bg-gray-900 text-white flex flex-col font-sans">
        <div className={`p-6 text-center shadow-2xl z-[999] transition-colors duration-500 ${isDanger ? 'bg-red-600 animate-pulse' : 'bg-gray-800'}`}>
          <button onClick={handleLogout} className="absolute top-6 right-6 bg-red-600 px-4 py-2 rounded font-bold text-sm shadow hover:bg-red-700 cursor-pointer">LOGOUT</button>
          <h1 className="text-3xl font-black uppercase tracking-widest">Family SOS Tracker</h1>
          <p className="text-xl mt-2 font-bold uppercase text-gray-300">Tracking: {linkedDriver ? (linkedDriver.plate_number || "UNKNOWN") : "SEARCHING FOR VEHICLE..."}</p>
          {linkedDriver && (
            <div className="mt-4 inline-block bg-white px-8 py-3 rounded-full shadow-lg">
              <span className="font-black text-gray-800 text-lg">AI STATUS: </span>
              <span className={`font-black text-xl ml-2 ${isDanger ? 'text-red-600 font-black' : 'text-green-500'}`}>{linkedDriver.ai_status || "SAFE"}</span>
            </div>
          )}
        </div>
        <div className="flex-1 flex flex-col md:flex-row">
          <div className="w-full md:w-1/3 p-6 flex flex-col bg-gray-900 border-r-4 border-gray-800">
            <h2 className="font-black mb-4 text-xl tracking-widest text-blue-400">LIVE DRIVER CAM</h2>
            <div className="flex-1 bg-black rounded-2xl overflow-hidden border-4 border-gray-700 shadow-2xl relative flex items-center justify-center">
              <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {!remoteVideoRef.current?.srcObject && <div className="absolute text-center text-gray-500 font-bold tracking-widest p-4">WAITING FOR DRIVER VIDEO...</div>}
            </div>
          </div>
          <div className="w-full md:w-2/3 relative">
            <MapContainer center={[linkedDriver?.lat || 23.0625, linkedDriver?.lng || 72.5314]} zoom={15} style={{ height: '100%', width: '100%', zIndex: 1 }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {linkedDriver?.lat && linkedDriver?.lng && (
                <Marker position={[linkedDriver.lat, linkedDriver.lng]} icon={familyIcon}>
                  <Popup><strong>{linkedDriver.plate_number || "UNKNOWN"} (TRACKED)</strong></Popup>
                </Marker>
              )}
            </MapContainer>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden font-sans">
      {(myProfile.role === 'private' || myProfile.role === 'fleet') && (
        <>
          <div className="absolute top-6 left-6 z-[990] bg-white p-4 rounded-xl shadow-xl border-l-4 border-blue-600">
            <h2 className="font-black text-gray-900 text-lg uppercase">{myProfile.role} DASHBOARD</h2>
            <p className="text-gray-600 font-mono text-sm mt-1 uppercase">Plate: {myProfile.plate_number}</p>
            
            {/* RESTORED TEST V2X VOICE ALERT BUTTON */}
            <div className="mt-3 border-t pt-2">
              <button onClick={testVoiceAlert} className="text-xs font-black text-blue-600 underline cursor-pointer hover:text-blue-800 block mb-1">
                [Test V2X Voice Alert]
              </button>
              <button onClick={handleLogout} className="text-xs font-black text-red-600 underline cursor-pointer hover:text-red-800 block">
                [LOGOUT / SWITCH USER]
              </button>
            </div>
          </div>

          <button onClick={() => setShowSosModal(true)} className="absolute top-6 right-6 z-[990] bg-red-600 text-white px-6 py-3 rounded-xl font-black shadow-xl hover:bg-red-700 uppercase tracking-widest border-2 border-red-400 animate-pulse cursor-pointer">
            SOS FAMILY SETUP
          </button>

          {showSosModal && (
            <div className="absolute top-0 left-0 w-full h-full bg-black/80 z-[9999] flex items-center justify-center">
              <div className="bg-gray-900 p-8 rounded-3xl border-2 border-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.5)] text-center w-[90%] max-w-md">
                <h2 className="text-white font-black text-2xl mb-2">LINK SOS FAMILY</h2>
                <p className="text-gray-400 text-sm mb-6 font-bold">Enter the email address your family member will use to log in to the tracker.</p>
                <input type="email" value={sosEmailInput} onChange={(e) => setSosEmailInput(e.target.value)} className="w-full p-4 rounded-xl mb-6 text-black font-black outline-none text-center text-lg" placeholder="family@test.com" />
                <div className="flex gap-4">
                  <button onClick={() => setShowSosModal(false)} className="flex-1 bg-gray-600 text-white font-black py-4 rounded-xl hover:bg-gray-500 cursor-pointer">CANCEL</button>
                  <button onClick={async () => {
                      await supabase.from('profiles').update({ sos_email: sosEmailInput }).eq('id', session.user.id);
                      setMyProfile({ ...myProfile, sos_email: sosEmailInput });
                      setShowSosModal(false);
                      alert("SOS Family linked successfully!");
                    }} className="flex-1 bg-green-500 text-white font-black py-4 rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.5)] hover:bg-green-400 cursor-pointer">SAVE LINK</button>
                </div>
              </div>
            </div>
          )}

          <DashcamAI userId={session.user.id} />
          
          {/* DUAL STAGE V2X ALERT UI */}
          {v2xWarningLevel === 1 && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[999] bg-yellow-500 text-black p-6 rounded-xl shadow-2xl animate-pulse text-xl font-black border-4 border-yellow-700 text-center w-[90%] max-w-lg">
              ⚠️ AMBULANCE APPROACHING (1KM) ⚠️ <br/> Clear Overtaking Lane!
            </div>
          )}
          {v2xWarningLevel === 2 && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[999] bg-red-600 text-white p-6 rounded-xl shadow-2xl animate-pulse text-2xl font-black border-4 border-red-900 text-center w-[90%] max-w-lg">
              🚨 AMBULANCE IMMINENT (50m) 🚨 <br/> Pull Over Immediately!
            </div>
          )}
        </>
      )}

      {myProfile.role === 'emergency' && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[999] bg-white p-6 rounded-2xl shadow-2xl w-[90%] max-w-lg text-center border-t-4 border-red-600">
          <h2 className="font-black text-gray-900 text-2xl mb-1 uppercase">UNIT: {myProfile.plate_number}</h2>
          <button onClick={handleLogout} className="absolute top-6 right-6 text-xs font-black text-red-600 underline cursor-pointer hover:text-red-800">[LOGOUT]</button>
          <p className={`font-bold mb-4 ${myProfile.is_emergency ? 'text-red-600 animate-pulse' : 'text-gray-500'}`}>
            {isRouting ? 'SCANNING FOR NEAREST HOSPITAL...' : (myProfile.is_emergency && targetHospital ? `ROUTING TO: ${targetHospital.name.toUpperCase()}` : 'STANDBY MODE')}
          </p>
          <button onClick={toggleEmergency} disabled={isRouting} className={`w-full py-4 text-xl font-extrabold rounded-xl shadow-lg text-white cursor-pointer ${myProfile.is_emergency ? 'bg-gray-800 hover:bg-gray-900' : 'bg-red-600 hover:bg-red-700'}`}>
            {myProfile.is_emergency ? 'DEACTIVATE EMERGENCY' : 'ACTIVATE EMERGENCY ROUTE'}
          </button>
        </div>
      )}

      <MapContainer center={[myProfile.lat, myProfile.lng]} zoom={14} style={{ height: '100%', width: '100%', zIndex: 1 }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {hospitalRoute && myProfile.role === 'emergency' && <Polyline positions={hospitalRoute} color="#dc2626" weight={8} opacity={0.8} />}
        {myProfile.is_emergency && targetHospital && <Marker position={targetHospital.coords}><Popup><strong>{targetHospital.name}</strong></Popup></Marker>}
        <Marker position={[myProfile.lat, myProfile.lng]} icon={myProfile.role === 'emergency' ? emergencyIcon : (myProfile.role === 'fleet' ? fleetIcon : privateIcon)}>
          <Popup><strong>{myProfile.plate_number} (YOU)</strong></Popup>
        </Marker>
        {allUsers.filter(u => u.id !== session.user.id).map(user => (
          user.lat && user.lng && (
            <Marker key={user.id} position={[user.lat, user.lng]} icon={user.role === 'emergency' ? emergencyIcon : (user.role === 'fleet' ? fleetIcon : privateIcon)}>
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