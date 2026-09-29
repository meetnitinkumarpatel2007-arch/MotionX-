import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Auth({ onLogin }) {
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('private')
  const [plateNumber, setPlateNumber] = useState('GJ-01-TEST')
  const [errorMessage, setErrorMessage] = useState('')

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErrorMessage('')

    if (isSignUp) {
      // Pass the exact role and plate number to Supabase Auth Metadata
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            role: role,
            plate_number: plateNumber
          }
        }
      })

      if (error) {
        setErrorMessage(error.message)
        setLoading(false)
        return
      }

      if (data?.user) {
        // TIMING FIX: Wait 1.5 seconds for the SQL Trigger to build the profile
        setTimeout(async () => {
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).maybeSingle()
          onLogin(data.user, profile)
        }, 1500)
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setErrorMessage(error.message)
        setLoading(false)
        return
      }
      if (data?.user) {
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).maybeSingle()
        onLogin(data.user, profile)
      }
    }
  }

  return (
    <div className="flex h-[100dvh] w-screen items-center justify-center bg-gray-950 font-sans p-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 p-8 rounded-3xl shadow-2xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black text-white tracking-wider">MOTIONX</h1>
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mt-1">Smart V2X Ecosystem</p>
        </div>

        {errorMessage && (
          <div className="mb-4 bg-red-950 border border-red-800 text-red-300 text-xs font-bold p-3 rounded-xl text-center">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Email Address</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-3.5 bg-gray-800 border border-gray-700 text-white rounded-xl font-bold outline-none focus:border-blue-500" placeholder="user@motionx.com" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-3.5 bg-gray-800 border border-gray-700 text-white rounded-xl font-bold outline-none focus:border-blue-500" placeholder="........" />
          </div>

          {isSignUp && (
            <>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Vehicle Role / Account Type</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full p-3.5 bg-gray-800 border border-gray-700 text-white rounded-xl font-bold outline-none focus:border-blue-500 cursor-pointer">
                  <option value="private">Private Vehicle / Citizen</option>
                  <option value="fleet">Fleet Management</option>
                  <option value="emergency">Emergency / Ambulance Unit</option>
                  <option value="family">SOS Family Tracker</option>
                </select>
              </div>
              {role !== 'family' && (
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Plate Number / Unit ID</label>
                  <input type="text" required value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} className="w-full p-3.5 bg-gray-800 border border-gray-700 text-white rounded-xl font-bold uppercase outline-none focus:border-blue-500" placeholder="GJ-01-AB-1234" />
                </div>
              )}
            </>
          )}

          <button type="submit" disabled={loading} className="w-full mt-2 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black uppercase tracking-wider shadow-lg shadow-blue-600/30 transition-all active:scale-95 cursor-pointer">
            {loading ? 'Processing...' : (isSignUp ? 'Register Account' : 'Secure Login')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button onClick={() => setIsSignUp(!isSignUp)} className="text-xs font-bold text-gray-400 hover:text-white underline cursor-pointer">
            {isSignUp ? 'Already registered? Login here.' : 'Need an account? Register.'}
          </button>
        </div>
      </div>
    </div>
  )
}