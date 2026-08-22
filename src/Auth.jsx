import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Auth({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [role, setRole] = useState('private')
  const [loading, setLoading] = useState(false)
  const [isLoginView, setIsLoginView] = useState(true)

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    
    try {
      const { data, error } = !isLoginView 
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })

      if (error) throw error

      if (data.user) {
        // ALWAYS save the role during Register, or update it on Login
        await supabase.from('profiles').upsert({ 
          id: data.user.id, 
          role: role,
          plate_number: plateNumber.toUpperCase() || 'UNKNOWN',
        })
        onLogin(data.user)
      }
    } catch (error) {
      alert("Error: " + error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex h-screen items-center justify-center bg-gray-900 font-sans">
      
      {/* HIGH-QUALITY HIGHWAY IMAGE BACKGROUND */}
      <img 
        src="https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?q=80&w=2070&auto=format&fit=crop" 
        alt="Smart Highway" 
        className="absolute z-0 w-full h-full object-cover opacity-40 pointer-events-none" 
      />

      {/* MODERN RECTANGULAR LOGIN CARD */}
      <div className="relative z-10 w-full max-w-md p-8 bg-white/95 backdrop-blur-md shadow-2xl rounded-2xl border border-gray-200">
        
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">MotionX</h1>
          <p className="text-blue-600 text-sm font-bold mt-2 tracking-wide uppercase">Smart V2X Ecosystem</p>
        </div>

        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          
          {/* ALWAYS SHOW ROLE SELECTOR SO THE DATABASE NEVER GETS CONFUSED */}
          <div className="flex flex-col gap-4">
            {!isLoginView && (
              <input 
                type="text" 
                placeholder="Vehicle Plate (e.g. GJ-01-XX-1234)" 
                value={plateNumber} 
                onChange={(e) => setPlateNumber(e.target.value)} 
                className="p-3 bg-gray-50 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-bold transition-all" 
                required={!isLoginView} 
              />
            )}
            <select 
              value={role} 
              onChange={(e) => setRole(e.target.value)} 
              className="p-3 bg-gray-50 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold transition-all"
            >
              <option value="private">Private Owner</option>
              <option value="fleet">Fleet / Government</option>
              <option value="emergency">Emergency Response</option>
            </select>
          </div>
          
          <input 
            type="email" 
            placeholder="Email Address" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            className="p-3 bg-gray-50 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
            required 
          />
          <input 
            type="password" 
            placeholder="Password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            className="p-3 bg-gray-50 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
            required 
          />
          
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-bold shadow-lg transition-all mt-4 text-lg"
          >
            {loading ? 'Processing...' : (isLoginView ? 'Login to Dashboard' : 'Register Vehicle')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => setIsLoginView(!isLoginView)} 
            className="text-gray-500 hover:text-blue-700 text-sm font-bold transition-colors underline"
            type="button"
          >
            {isLoginView ? "New user? Register your vehicle here." : "Already registered? Login here."}
          </button>
        </div>

      </div>
    </div>
  )
}