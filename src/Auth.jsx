import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Auth({ onLogin }) {
  const [loading, setLoading] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('private')
  const [plateNumber, setPlateNumber] = useState('')

  const handleAuth = async () => {
    setLoading(true)
    try {
      // Family viewers don't need a real plate, but vehicles do!
      const finalPlate = role === 'family' ? 'SOS-VIEWER' : (plateNumber || 'UNKNOWN-PLATE');
      let authUser = null;

      if (isRegistering) {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        authUser = data.user;
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        authUser = data.user;
      }

      if (authUser) {
        if (isRegistering) {
          await supabase.from('profiles').upsert({ id: authUser.id, role: role, plate_number: finalPlate, lat: 23.0625, lng: 72.5314 });
          onLogin(authUser, { id: authUser.id, role: role, plate_number: finalPlate, lat: 23.0625, lng: 72.5314 });
        } else {
          // On Login, fetch existing profile so we don't overwrite their original plate
          const { data: existing } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
          if (!existing) {
             await supabase.from('profiles').upsert({ id: authUser.id, role: role, plate_number: finalPlate, lat: 23.0625, lng: 72.5314 });
          }
          onLogin(authUser, existing || { id: authUser.id, role: role, plate_number: finalPlate, lat: 23.0625, lng: 72.5314 });
        }
      }
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen items-center justify-center bg-gray-900 text-white font-sans p-4">
      <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border-t-4 border-blue-500">
        <h1 className="text-3xl font-black mb-2 text-center tracking-widest uppercase">MotionX</h1>
        <p className="text-blue-400 font-bold text-center mb-6 text-sm tracking-widest uppercase">Smart V2X Ecosystem</p>
        
        {isRegistering && role !== 'family' && (
          <input type="text" placeholder="License Plate (e.g. GJ 04 PR 1508)" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value.toUpperCase())} className="w-full mb-4 p-4 rounded bg-gray-700 text-white font-bold outline-none border border-gray-600 focus:border-blue-500" />
        )}
        
        <input type="email" placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mb-4 p-4 rounded bg-gray-700 text-white outline-none border border-gray-600 focus:border-blue-500" />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mb-4 p-4 rounded bg-gray-700 text-white outline-none border border-gray-600 focus:border-blue-500" />
        
        <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full mb-6 p-4 rounded bg-gray-700 text-white outline-none border border-gray-600 font-bold uppercase tracking-wider">
          <option value="private">Private Owner 🚘</option>
          <option value="emergency">Emergency Unit 🚑</option>
          <option value="fleet">Fleet / Government 🏢</option>
          <option value="family">SOS Family Member 👨‍👩‍👧</option>
        </select>
        
        <button onClick={handleAuth} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 font-bold py-4 rounded-lg shadow-lg transition-all cursor-pointer">
          {loading ? 'PROCESSING...' : (isRegistering ? 'REGISTER VEHICLE' : 'LOGIN TO DASHBOARD')}
        </button>

        <p className="text-center mt-6 text-sm text-gray-400 font-bold cursor-pointer hover:text-white underline" onClick={() => setIsRegistering(!isRegistering)}>
          {isRegistering ? "Already registered? Login here." : "Need to register? Click here."}
        </p>
      </div>
    </div>
  )
}