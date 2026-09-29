import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from './supabaseClient'
import Auth from './Auth'
import DashcamAI from './DashcamAI'
import Peer from 'peerjs'
import 'leaflet/dist/leaflet.css'

const emergencyIcon = L.divIcon({ className: 'custom-icon', html: '<div style="font-size: 26px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #dc2626; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🚑</div>', iconSize: [44, 44], iconAnchor: [22, 44] });
const privateIcon = L.divIcon({ className: 'custom-icon', html: '<div style="font-size: 26px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #2563eb; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🚘</div>', iconSize: [44, 44], iconAnchor: [22, 44] });
const fleetIcon = L.divIcon({ className: 'custom-icon', html: '<div style="font-size: 26px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #9333ea; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🏢</div>', iconSize: [44, 44], iconAnchor: [22, 44] });
const familyIcon = L.divIcon({ className: 'custom-icon', html: '<div style="font-size: 26px; background: white; border-radius: 50%; padding: 4px; border: 3px solid #22c55e; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">📍</div>', iconSize: [44, 44], iconAnchor: [22, 44] });

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; 
  const p1 = lat1 * Math.PI / 180; 
  const p2 = lat2 * Math.PI / 180; 
  const dp = (lat2 - lat1) * Math.PI / 180; 
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function App() {
  const [session, setSession] = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [allUsers, setAllUsers] = useState([])
  const [v2xWarningLevel, setV2xWarningLevel] = useState(0) 
  const [nearestAmbDistance, setNearestAmbDistance] = useState(null) 
  const [targetHospital, setTargetHospital] = useState(null)
  const [hospitalRoute, setHospitalRoute] = useState(null) 
  const [isRouting, setIsRouting] = useState(false)
  const [showSosModal, setShowSosModal] = useState(false)
  const [sosEmailInput, setSosEmailInput] = useState("")
  const [linkedDriver, setLinkedDriver] = useState(null)
  const remoteVideoRef = useRef(null)
  const [isVideoLive, setIsVideoLive] = useState(false)

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

  // Real-time synchronization
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

  // V2X Proximity & Distance Calculation
  useEffect(() => {
    if (myProfile?.role !== 'private' && myProfile?.role !== 'fleet') return
    const activeAmbulances = allUsers.filter(u => u.role === 'emergency' && u.is_emergency)
    let currentWarningLevel = 0; 
    let minDistance = null;

    activeAmbulances.forEach(amb => {
      if (amb.lat && amb.lng && myProfile.lat && myProfile.lng) {
        const dist = getDistance(amb.lat, amb.lng, myProfile.lat, myProfile.lng);
        const roundedDist = Math.round(dist);
        if (minDistance === null || roundedDist < minDistance) minDistance = roundedDist;
        if (dist <= 50) { currentWarningLevel = 2; } 
        else if (dist <= 1000 && currentWarningLevel < 2) { currentWarningLevel = 1; }
      }
    })

    setNearestAmbDistance(minDistance)
    if (currentWarningLevel > 0 && v2xWarningLevel === 0) {
      const msg = currentWarningLevel === 2 ? "Ambulance Imminent. Please clear overtaking lane, ambulance is arriving. " : "Please clear overtaking lane, ambulance is arriving.";
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg))
    }
    setV2xWarningLevel(currentWarningLevel)
  }, [allUsers, myProfile, v2xWarningLevel])

  // Hospital Finder (Vercel Bug Fix applied using string concatenation)
  const findNearestHospital = async (lat, lng) => {
    try {
      const query = '[out:json][timeout:5];node(around:8000,' + lat + ',' + lng + ')["amenity"="hospital"];out 1;';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query), { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.elements && data.elements.length > 0) {
        return { name: data.elements[0].tags?.name || "Civil / District Hospital", coords: [data.elements[0].lat, data.elements[0].lon] };
      }
    } catch (err) {
      console.warn("Overpass API fallback active:", err);
    }
    return { name: "Apex Trauma & Emergency Hospital", coords: [lat + 0.012, lng + 0.014] };
  }

  // Emergency Routing (Vercel Bug Fix applied using string concatenation)
  const toggleEmergency = async () => {
    if (myProfile?.is_emergency || isRouting) {
      setIsRouting(false); setTargetHospital(null); setHospitalRoute(null);
      const updatedProfile = { ...myProfile, is_emergency: false };
      setMyProfile(updatedProfile);
      if (session?.user?.id) await supabase.from('profiles').update({ is_emergency: false }).eq('id', session.user.id);
      return;
    }

    if (!myProfile?.lat || !myProfile?.lng) return alert("Location coordinates not found. Please enable GPS.");

    setIsRouting(true);
    const updatedProfile = { ...myProfile, is_emergency: true };
    setMyProfile(updatedProfile);
    if (session?.user?.id) await supabase.from('profiles').update({ is_emergency: true }).eq('id', session.user.id);

    try {
      const hospital = await findNearestHospital(myProfile.lat, myProfile.lng);
      setTargetHospital(hospital);
      const osrmUrl = 'https://router.project-osrm.org/route/v1/driving/' + myProfile.lng + ',' + myProfile.lat + ';' + hospital.coords[1] + ',' + hospital.coords[0] + '?overview=full&geometries=geojson';
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();

      if (osrmData.routes && osrmData.routes.length > 0) {
        const polyCoords = osrmData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        setHospitalRoute(polyCoords);
      } else {
        setHospitalRoute([[myProfile.lat, myProfile.lng], hospital.coords]);
      }
    } catch (error) {
      console.error("Emergency routing error:", error);
      const fallbackHospital = { name: "Apex Trauma & Emergency Hospital", coords: [myProfile.lat + 0.012, myProfile.lng + 0.014] };
      setTargetHospital(fallbackHospital); setHospitalRoute([[myProfile.lat, myProfile.lng], fallbackHospital.coords]);
    } finally {
      setIsRouting(false);
    }
  };

  const enforceProfile = async (lat, lng) => {
    const updatedProfile = { ...myProfile, lat, lng };
    setMyProfile(updatedProfile);
    if (session?.user?.id) await supabase.from('profiles').update({ lat, lng }).eq('id', session.user.id);
  }

  const triggerOverride = () => enforceProfile((myProfile?.lat || 23.0625) + 0.002, (myProfile?.lng || 72.5314) + 0.002);
  
  const forceRealGPS = () => {
    if (!navigator.geolocation) return alert("Geolocation is not supported by your browser");
    navigator.geolocation.getCurrentPosition(
      (pos) => enforceProfile(pos.coords.latitude, pos.coords.longitude),
      (err) => alert("GPS Error: " + err.message),
      { enableHighAccuracy: true }
    );
    setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => enforceProfile(pos.coords.latitude, pos.coords.longitude),
        (err) => console.warn("GPS Background update failed:", err.message),
        { enableHighAccuracy: true }
      );
    }, 5000);
    alert("Real-Time Continuous GPS Tracking Enabled!");
  };

  const testVoiceAlert = () => {
    window.speechSynthesis.speak(new SpeechSynthesisUtterance("Please clear overtaking lane, ambulance is arriving."));
  };

  // SOS Family Polling
  useEffect(() => {
    if (myProfile?.role === 'family' && session?.user?.email) {
      const fetchDriver = async () => {
        const { data } = await supabase.from('profiles').select('*').eq('sos_email', session.user.email).maybeSingle();
        if (data) setLinkedDriver(data);
      }
      fetchDriver();
      const interval = setInterval(fetchDriver, 6000);
      return () => clearInterval(interval);
    }
  }, [myProfile?.role, session?.user?.email])

  // SOS Family WebRTC Video
  useEffect(() => {
    if (myProfile?.role !== 'family' || !linkedDriver?.id) return;
    let peer = null; let activeCall = null; let retryInterval = null;

    const connectToDriver = () => {
      if (peer) peer.destroy(); 
      setIsVideoLive(false);
      peer = new Peer({ config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }});
      
      peer.on('open', () => {
        let dummyStream = null;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 1; canvas.height = 1;
          const capture = canvas.captureStream || canvas.mozCaptureStream || canvas.webkitCaptureStream;
          if(capture) dummyStream = capture.call(canvas, 1);
        } catch(e) { console.warn("Dummy stream failed", e); }

        const targetPeerId = 'motionx-driver-' + linkedDriver.id;
        activeCall = peer.call(targetPeerId, dummyStream);
        
        if (activeCall) {
          activeCall.on('stream', (remoteStream) => {
            setIsVideoLive(true); 
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
              remoteVideoRef.current.play().catch(e => console.log("Video autoplay caught:", e));
            }
          });
          activeCall.on('close', () => setIsVideoLive(false));
          activeCall.on('error', () => setIsVideoLive(false));
        }
      });
      peer.on('error', () => setIsVideoLive(false));
    };

    connectToDriver();
    retryInterval = setInterval(() => {
      const videoElement = remoteVideoRef.current;
      if (!videoElement || !videoElement.srcObject || !videoElement.srcObject.active) connectToDriver();
      else setIsVideoLive(true);
    }, 8000);

    return () => {
      clearInterval(retryInterval);
      if (activeCall) activeCall.close();
      if (peer) peer.destroy();
    };
  }, [myProfile?.role, linkedDriver?.id]);

  if (!session) return <Auth onLogin={(user, localProfile) => { setSession({ user }); if (localProfile) setMyProfile(localProfile); fetchProfile(user.id); }} />
  
  if (!myProfile) return (
    <div className="flex flex-col h-[100dvh] items-center justify-center bg-gray-900 text-white font-sans gap-4 p-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-500 mb-2"></div>
      <div className="text-xl font-bold tracking-widest uppercase">Loading Secure Profile...</div>
      <button onClick={handleLogout} className="mt-4 px-6 py-3 bg-red-600 rounded font-bold shadow-lg hover:bg-red-700 cursor-pointer">FORCE LOGOUT / RETRY</button>
    </div>
  )
  
  if (!myProfile.lat && myProfile.role !== 'family') return (
    <div className="flex flex-col h-[100dvh] items-center justify-center bg-gray-100 text-gray-800 gap-4 p-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-600 mb-2"></div>
      <div className="text-xl font-bold">Acquiring Secure V2X Network...</div>
      <button onClick={forceRealGPS} className="w-full max-w-sm mt-4 px-6 py-4 bg-blue-600 text-white rounded-lg font-bold shadow-xl cursor-pointer">ALLOW LOCATION (LIVE GPS)</button>
      <p className="text-gray-500 font-bold">OR</p>
      <button onClick={triggerOverride} className="w-full max-w-sm px-6 py-4 bg-red-600 text-white rounded-lg font-bold shadow-xl cursor-pointer">FORCE OVERRIDE (DEMO MAP)</button>
      <button onClick={handleLogout} className="mt-6 text-sm font-bold text-red-600 underline cursor-pointer">Log Out</button>
    </div>
  )

  if (myProfile.role === 'family') {
    const isDanger = linkedDriver?.ai_status === 'DROWSY' || linkedDriver?.ai_status === 'PHONE DETECTED';
    return (
      <div className="h-[100dvh] w-screen bg-gray-900 text-white flex flex-col font-sans overflow-hidden">
        <div className={'p-3 md:p-6 text-center shadow-2xl z-[999] transition-colors duration-500 flex-shrink-0 ' + (isDanger ? 'bg-red-600 animate-pulse' : 'bg-gray-800')}>
          <button onClick={handleLogout} className="absolute top-4 right-4 bg-red-600 px-3 py-1.5 md:px-4 md:py-2 rounded font-bold text-xs md:text-sm shadow hover:bg-red-700 cursor-pointer">LOGOUT</button>
          <h1 className="text-xl md:text-3xl font-black uppercase tracking-widest">Family SOS Tracker</h1>
          <p className="text-xs md:text-lg mt-1 font-bold uppercase text-gray-300">Tracking: {linkedDriver ? (linkedDriver.plate_number || "UNKNOWN") : "SEARCHING FOR VEHICLE..."}</p>
          {linkedDriver && (
            <div className="mt-2 inline-block bg-white px-4 md:px-8 py-1 md:py-2 rounded-full shadow-lg">
              <span className="font-black text-gray-800 text-xs md:text-base">AI STATUS: </span>
              <span className={'font-black text-xs md:text-base ml-2 ' + (isDanger ? 'text-red-600' : 'text-green-500')}>{linkedDriver.ai_status || "SAFE"}</span>
            </div>
          )}
        </div>
        <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
          <div className="w-full md:w-1/3 p-3 md:p-4 flex flex-col bg-gray-900 border-b-2 md:border-b-0 md:border-r-4 border-gray-800 z-10">
            <h2 className="font-black mb-2 text-xs md:text-lg tracking-widest text-blue-400 text-center md:text-left">LIVE DRIVER CAM</h2>
            <div className="w-full aspect-video md:aspect-auto md:flex-1 bg-black rounded-xl overflow-hidden border-2 md:border-4 border-gray-700 shadow-2xl relative flex items-center justify-center">
              <video ref={remoteVideoRef} autoPlay playsInline muted className={'w-full h-full object-cover ' + (!isVideoLive ? 'hidden' : 'block')} />
              {!isVideoLive && (
                <div className="absolute text-center text-gray-500 font-bold tracking-widest p-4 flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                  <span className="text-xs md:text-sm">WAITING FOR DRIVER VIDEO...</span>
                  <span className="text-[10px] text-gray-600">AUTO-RETRYING CONNECTION</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 w-full relative z-0">
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
    <div className="relative h-[100dvh] w-screen overflow-hidden font-sans">
      
      {(myProfile.role === 'private' || myProfile.role === 'fleet') && (
        <>
          <div className="absolute top-3 left-3 md:top-6 md:left-6 z-[990] bg-white p-3 md:p-4 rounded-xl shadow-xl border-l-4 border-blue-600 max-w-[210px] md:max-w-xs">
            <h2 className="font-black text-gray-900 text-xs md:text-base uppercase tracking-wider">{myProfile.role} DASHBOARD</h2>
            <p className="text-gray-600 font-mono text-[11px] md:text-sm mt-0.5 uppercase">Plate: {myProfile.plate_number}</p>
            
            {nearestAmbDistance !== null && (
              <div className={'mt-2 p-1.5 rounded-lg text-[11px] md:text-xs font-black text-center ' + (nearestAmbDistance <= 50 ? 'bg-red-100 text-red-700 border border-red-400 animate-pulse' : (nearestAmbDistance <= 1000 ? 'bg-amber-100 text-amber-800 border border-amber-400' : 'bg-blue-50 text-blue-700'))}>
                🚑 Active Amb: {nearestAmbDistance + 'm away'}
              </div>
            )}
            <div className="mt-2 border-t pt-2">
              <button onClick={testVoiceAlert} className="text-[11px] md:text-xs font-black text-blue-600 underline cursor-pointer hover:text-blue-800 block mb-1">[Test V2X Voice Alert]</button>
              <button onClick={handleLogout} className="text-[11px] md:text-xs font-black text-red-600 underline cursor-pointer hover:text-red-800 block">[LOGOUT / SWITCH USER]</button>
            </div>
          </div>

          <button onClick={() => setShowSosModal(true)} className="absolute top-3 right-3 md:top-6 md:right-6 z-[990] bg-red-600 text-white px-3 py-2 md:px-5 md:py-3 rounded-xl text-xs md:text-sm font-black shadow-xl hover:bg-red-700 uppercase tracking-wider border-2 border-red-400 animate-pulse cursor-pointer">
            SOS FAMILY SETUP
          </button>

          {showSosModal && (
            <div className="absolute top-0 left-0 w-full h-full bg-black/80 z-[9999] flex items-center justify-center p-4">
              <div className="bg-gray-900 p-6 md:p-8 rounded-3xl border-2 border-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.5)] text-center w-full max-w-md">
                <h2 className="text-white font-black text-xl md:text-2xl mb-2">LINK SOS FAMILY</h2>
                <p className="text-gray-400 text-xs md:text-sm mb-5 font-bold">Enter the email address your family member will use to log in to the tracker.</p>
                <input type="email" value={sosEmailInput} onChange={(e) => setSosEmailInput(e.target.value)} className="w-full p-3.5 rounded-xl mb-5 text-black font-black outline-none text-center text-base md:text-lg" placeholder="family@test.com" />
                <div className="flex gap-3">
                  <button onClick={() => setShowSosModal(false)} className="flex-1 bg-gray-600 text-white font-black py-3 rounded-xl hover:bg-gray-500 cursor-pointer text-sm">CANCEL</button>
                  <button onClick={async () => {
                      const { data, error } = await supabase.from('profiles').update({ sos_email: sosEmailInput }).eq('id', session.user.id).select();
                      if (error) { alert("DATABASE ERROR: " + error.message); return; }
                      if (!data || data.length === 0) { alert("GHOST SESSION DETECTED: Please LOGOUT and log in again."); return; }
                      setMyProfile({ ...myProfile, sos_email: sosEmailInput });
                      setShowSosModal(false);
                      alert("SOS Family linked successfully!");
                    }} className="flex-1 bg-green-500 text-white font-black py-3 rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.5)] hover:bg-green-400 cursor-pointer text-sm">SAVE LINK</button>
                </div>
              </div>
            </div>
          )}

          <DashcamAI userId={session.user.id} />
          
          {v2xWarningLevel === 1 && (
            <div className="absolute top-3 md:top-6 left-1/2 -translate-x-1/2 z-[999] bg-yellow-500 text-black px-4 py-3 md:p-5 rounded-xl shadow-2xl animate-pulse text-sm md:text-lg font-black border-4 border-yellow-700 text-center w-[92%] max-w-lg">
              ⚠️ AMBULANCE APPROACHING ({nearestAmbDistance !== null ? nearestAmbDistance + 'm' : '1KM'}) ⚠️ <br/> Clear Overtaking Lane!
            </div>
          )}
          {v2xWarningLevel === 2 && (
            <div className="absolute top-3 md:top-6 left-1/2 -translate-x-1/2 z-[999] bg-red-600 text-white px-4 py-3 md:p-5 rounded-xl shadow-2xl animate-pulse text-base md:text-xl font-black border-4 border-red-900 text-center w-[92%] max-w-lg">
              🚨 AMBULANCE IMMINENT ({nearestAmbDistance !== null ? nearestAmbDistance + 'm' : '50m'}) 🚨 <br/> Clear Overtaking Lane, Ambulance approaching.
            </div>
          )}
        </>
      )}

      {myProfile.role === 'emergency' && (
        <div className="absolute bottom-5 left-4 right-4 md:bottom-8 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-lg z-[999] bg-white p-4 md:p-6 rounded-2xl shadow-2xl text-center border-t-4 border-red-600 max-h-[85dvh] overflow-y-auto">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-black text-gray-900 text-lg md:text-2xl uppercase">UNIT: {myProfile.plate_number || 'EMERGENCY'}</h2>
            <button onClick={handleLogout} className="text-xs font-black text-red-600 underline cursor-pointer hover:text-red-800">[LOGOUT]</button>
          </div>
          <p className={'font-bold text-xs md:text-sm mb-3 tracking-wide ' + (myProfile.is_emergency ? 'text-red-600 animate-pulse' : 'text-gray-500')}>
            {isRouting ? 'SCANNING FOR NEAREST HOSPITAL...' : (myProfile.is_emergency && targetHospital ? 'ROUTING TO: ' + targetHospital.name.toUpperCase() : 'STANDBY MODE')}
          </p>
          {myProfile.is_emergency && !isRouting && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold p-2.5 rounded-lg mb-3 flex items-center justify-between">
              <span>🚨 BROADCASTING V2X CORRIDOR (1KM / 50M)</span>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
              </span>
            </div>
          )}
          <button onClick={toggleEmergency} className={'w-full py-3.5 md:py-4 text-base md:text-xl font-extrabold rounded-xl shadow-lg text-white transition-all active:scale-95 cursor-pointer ' + (myProfile.is_emergency || isRouting ? 'bg-gray-900 hover:bg-black' : 'bg-red-600 hover:bg-red-700')}>
            {isRouting ? 'CANCEL SCANNING' : (myProfile.is_emergency ? 'DEACTIVATE EMERGENCY' : 'ACTIVATE EMERGENCY ROUTE')}
          </button>
        </div>
      )}

      <MapContainer center={[myProfile.lat, myProfile.lng]} zoom={14} style={{ height: '100%', width: '100%', zIndex: 1 }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {hospitalRoute && myProfile.role === 'emergency' && <Polyline positions={hospitalRoute} color="#dc2626" weight={7} opacity={0.85} />}
        {myProfile.is_emergency && targetHospital && (
          <Marker position={targetHospital.coords}>
            <Popup><div className="text-center"><strong>🏥 {targetHospital.name}</strong><br/><span className="text-xs text-red-600 font-bold">Emergency Destination</span></div></Popup>
          </Marker>
        )}
        <Marker position={[myProfile.lat, myProfile.lng]} icon={myProfile.role === 'emergency' ? emergencyIcon : (myProfile.role === 'fleet' ? fleetIcon : privateIcon)}>
          <Popup><strong>{myProfile.plate_number} (YOU)</strong></Popup>
        </Marker>
        {allUsers.filter(u => u.id !== session.user.id).map(user => (
          user.lat && user.lng && (
            <Marker key={user.id} position={[user.lat, user.lng]} icon={user.role === 'emergency' ? emergencyIcon : (user.role === 'fleet' ? fleetIcon : privateIcon)}>
              <Popup>
                <div className="text-center">
                  <strong className="text-base uppercase">{user.plate_number}</strong><br/>
                  <span className="uppercase text-xs font-bold text-gray-500">{user.role}</span> <br/>
                  {user.is_emergency && <span className="text-red-600 font-bold">🚨 EMERGENCY ACTIVE</span>}
                </div>
              </Popup>
            </Marker>
          )
        ))}
      </MapContainer>
    </div>
  )
}