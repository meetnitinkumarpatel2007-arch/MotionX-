import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Auth({ onLogin }) {
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('private')

  const handleAuth = async (type) => {
    setLoading(true)
    try {
      const plate = role === 'family' ? 'SOS-VIEWER' : (role === 'emergency' ? 'AMB-911' : (role === 'fleet' ? 'GOV-01' : 'GJ-01-XX'));
      let authUser = null;

      if (type === 'register') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        authUser = data.user;
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        authUser = data.user;
      }

      if (authUser) {
        // BULLETPROOF DATABASE SYNC: Upsert forces the row to exist perfectly
        await supabase.from('profiles').upsert({ id: authUser.id, role: role, plate_number: plate, lat: 23.0625, lng: 72.5314 });

        // THE MAGIC FIX: Instantly pass the profile to App.jsx to completely skip loading screens!
        onLogin(authUser, { id: authUser.id, role: role, plate_number: plate, lat: 23.0625, lng: 72.5314 });
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
        <h1 className="text-3xl font-black mb-6 text-center tracking-widest uppercase">MotionX Setup</h1>
        
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mb-4 p-4 rounded bg-gray-700 text-white outline-none border border-gray-600 focus:border-blue-500 transition-colors" />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mb-4 p-4 rounded bg-gray-700 text-white outline-none border border-gray-600 focus:border-blue-500 transition-colors" />
        
        <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full mb-6 p-4 rounded bg-gray-700 text-white outline-none border border-gray-600 font-bold uppercase tracking-wider">
          <option value="private">Private Driver 🚘</option>
          <option value="emergency">Emergency Unit 🚑</option>
          <option value="fleet">Fleet / Government 🏢</option>
          <option value="family">SOS Family Member 👨‍👩‍👧</option>
        </select>
        
        <div className="flex gap-4">
          <button onClick={() => handleAuth('login')} disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700 font-bold py-4 rounded-lg shadow-lg transition-all cursor-pointer">{loading ? '...' : 'LOGIN'}</button>
          <button onClick={() => handleAuth('register')} disabled={loading} className="flex-1 bg-gray-600 hover:bg-gray-500 font-bold py-4 rounded-lg shadow-lg transition-all cursor-pointer">{loading ? '...' : 'REGISTER'}</button>
        </div>
      </div>
    </div>
  )
}