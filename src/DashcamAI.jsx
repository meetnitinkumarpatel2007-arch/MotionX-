import React, { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";
import Peer from 'peerjs';
import { supabase } from './supabaseClient';

export default function DashcamAI({ userId }) {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const isProcessingRef = useRef(false); // The Frame Lock

  const [aiStatus, setAiStatus] = useState("CONNECTING TO AI CORE...");
  const [isDanger, setIsDanger] = useState(false);
  const [alertMessage, setAlertMessage] = useState("MONITORING DRIVER");
  const [eyesOpen, setEyesOpen] = useState(true);

  // Timers
  const phoneStartRef = useRef(null);
  const eyesClosedStartRef = useRef(null);
  const lastStatusRef = useRef("SAFE");

  // Crash-Proof Audio Alarm
  const playBeep = (freq, durationMs) => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(freq, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.15, ctx.currentTime); 
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + (durationMs / 1000));
    } catch (e) { console.error(e); }
  };

  // WebRTC Family Tunnel - BULLETPROOF ANSWER
  useEffect(() => {
    if (!userId) return;
    const peer = new Peer(`motionx-driver-${userId}`, {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
    });
    
    peer.on('call', (call) => {
      console.log("INCOMING SOS FAMILY CALL!");
      const stream = webcamRef.current?.video?.srcObject || webcamRef.current?.stream;
      
      if (stream) {
        call.answer(stream);
      } else {
        // Fallback: If React Webcam hasn't fully registered, ask the browser directly!
        navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          .then(mediaStream => call.answer(mediaStream))
          .catch(err => console.error("WebRTC Stream Error:", err));
      }
    });
    
    return () => peer.destroy();
  }, [userId]);
  // ==========================================
  // WEBSOCKET: CONNECT TO PYTHON BACKEND
  // ==========================================
  useEffect(() => {
    // Connect to Python (Change to Render URL later: wss://your-render-app.onrender.com/ws/detect)
    wsRef.current = new WebSocket("wss://motionx-python-ai.onrender.com/ws/detect");

    wsRef.current.onopen = () => setAiStatus("● PYTHON AI LINKED");
    
    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      processAiData(data);
      isProcessingRef.current = false; // Unlock frame! Allows React to send the next image.
    };

    wsRef.current.onclose = () => setAiStatus("SERVER OFFLINE");

    // The Frame Sending Loop (Takes tiny screenshots and sends them)
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && !isProcessingRef.current && webcamRef.current) {
        // Grab a lightweight image
        const imageSrc = webcamRef.current.getScreenshot({ width: 640, height: 480 });
        if (imageSrc) {
          isProcessingRef.current = true; // Lock frame so we don't spam the server
          wsRef.current.send(imageSrc);
        }
      }
    }, 150); // Attempts to run ~6-7 frames per second for AI processing

    return () => {
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, []);

  // ==========================================
  // PROCESS JSON FROM PYTHON & DRAW ON CANVAS
  // ==========================================
  const processAiData = (data) => {
    if (!webcamRef.current?.video) return;
    const video = webcamRef.current.video;
    const canvas = canvasRef.current;
    
    // Sync Canvas resolution to Video resolution
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let phoneDetected = false;

    // 1. Draw YOLO Objects from JSON
    data.objects.forEach(obj => {
      const [x, y, w, h] = obj.box;
      const label = obj.label;
      const conf = obj.conf;

      let color = label === 'cell phone' ? '#dc2626' : (label === 'bottle' ? '#3b82f6' : '#22c55e'); 
      ctx.strokeStyle = color; 
      ctx.lineWidth = 4; 
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = color; 
      ctx.font = 'bold 20px Arial';
      ctx.fillText(`${label.toUpperCase()} ${(conf * 100).toFixed(0)}%`, x, y > 20 ? y - 8 : 20);

      if (label === 'cell phone') phoneDetected = true;
    });

    // 2. Handle Phone Timer (5 Seconds)
    let phoneAlarm = false;
    if (phoneDetected) {
      if (!phoneStartRef.current) phoneStartRef.current = Date.now();
      else if ((Date.now() - phoneStartRef.current) / 1000 > 5) { phoneAlarm = true; playBeep(1000, 150); }
    } else { phoneStartRef.current = null; }

    // 3. Handle Haar Cascade Drowsiness Logic (3 Seconds)
    const eyesDetected = data.eyes_detected;
    setEyesOpen(eyesDetected);
    
    let drowsyAlarm = false;
    if (!eyesDetected) {
      if (!eyesClosedStartRef.current) eyesClosedStartRef.current = Date.now();
      else if ((Date.now() - eyesClosedStartRef.current) / 1000 > 3) { drowsyAlarm = true; playBeep(1200, 120); }
    } else { eyesClosedStartRef.current = null; }

    // 4. Update Dashboards & Supabase SOS Sync
    let currentStatus = "SAFE";
    let msg = "MONITORING DRIVER";

    if (phoneAlarm) { setIsDanger(true); currentStatus = "PHONE DETECTED"; msg = "PHONE DETECTED (DISTRACTION)"; } 
    else if (drowsyAlarm) { setIsDanger(true); currentStatus = "DROWSY"; msg = "DROWSINESS DETECTED!"; } 
    else { setIsDanger(false); }

    setAlertMessage(msg);

    if (currentStatus !== lastStatusRef.current && userId) {
      lastStatusRef.current = currentStatus;
      supabase.from('profiles').update({ ai_status: currentStatus }).eq('id', userId).then();
    }
  };

  return (
    <div className={`absolute bottom-6 right-6 z-[999] bg-gray-900/95 backdrop-blur border-2 p-5 rounded-3xl w-[640px] transition-all duration-300 ${isDanger ? 'border-red-600 shadow-[0_0_60px_rgba(220,38,38,0.7)] scale-[1.02]' : 'border-blue-500/50 shadow-2xl'}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-black text-white text-lg tracking-widest uppercase">MotionX</h3>
        
        <span className="text-gray-400 font-mono text-sm font-bold tracking-widest">
          PYTHON LOGIC: 
          <span className={eyesOpen ? "text-green-500 ml-2" : "text-red-500 ml-2 font-black animate-pulse"}>
            {eyesOpen ? "(EYES OPEN)" : "(EYES CLOSED)"}
          </span>
        </span>

        <span className={`text-sm font-black ${aiStatus.includes("LINKED") ? 'text-green-500 animate-pulse' : 'text-yellow-500'}`}>
          {aiStatus}
        </span>
      </div>
      
      <div className="relative rounded-2xl overflow-hidden border-2 border-gray-700 bg-black aspect-video shadow-inner">
        {/* We use screenshotFormat="image/webp" to heavily compress the image before sending to Python! */}
        <Webcam 
          ref={webcamRef} 
          audio={false} 
          screenshotFormat="image/webp" 
          screenshotQuality={0.5} 
          className="absolute top-0 left-0 w-full h-full object-cover" 
          mirrored={true} 
        />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full z-10" />
      </div>
      
      <div className={`mt-5 text-center text-sm font-black p-4 rounded-xl tracking-widest transition-colors ${isDanger ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-gray-400'}`}>
        {alertMessage}
      </div>
    </div>
  );
}