import React, { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";
import Peer from 'peerjs';
import { supabase } from './supabaseClient';

// TENSORFLOW LOCAL EDGE AI
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as cocossd from '@tensorflow-models/coco-ssd';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';

export default function DashcamAI({ userId }) {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const earTextRef = useRef(null); // Bypasses React state to prevent freezing!
  const isProcessingRef = useRef(false);

  const [aiStatus, setAiStatus] = useState("LOADING EDGE AI...");
  const [isDanger, setIsDanger] = useState(false);
  const [alertMessage, setAlertMessage] = useState("MONITORING DRIVER");
  const [eyesOpen, setEyesOpen] = useState(true);

  const phoneStartRef = useRef(null);
  const eyesClosedStartRef = useRef(null);
  const lastStatusRef = useRef("SAFE");
  const lastEyesOpenRef = useRef(true); // Tracks eye state without re-rendering

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

  useEffect(() => {
    if (!userId) return;
    const peer = new Peer(`motionx-driver-${userId}`, {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
    });
    peer.on('call', (call) => {
      const stream = webcamRef.current?.video?.srcObject || webcamRef.current?.stream;
      if (stream) call.answer(stream);
      else navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(mediaStream => call.answer(mediaStream));
    });
    return () => peer.destroy();
  }, [userId]);

  // LOAD TENSORFLOW DIRECTLY INTO BROWSER MEMORY
  useEffect(() => {
    let isActive = true;
    let objectDetector = null;
    let faceDetector = null;

    const initAI = async () => {
      try {
        await tf.setBackend('webgl');
        await tf.ready();
        
        objectDetector = await cocossd.load();
        
        const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
        const detectorConfig = { runtime: 'tfjs', maxFaces: 1 };
        faceDetector = await faceLandmarksDetection.createDetector(model, detectorConfig);

        if (isActive) {
          setAiStatus("● EDGE AI ACTIVE");
          startDetectionLoop();
        }
      } catch (e) {
        console.error("Failed to load Edge AI:", e);
        setAiStatus("AI LOAD FAILED");
      }
    };

    const getDistance = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

    const startDetectionLoop = async () => {
      if (!isActive) return;
      const video = webcamRef.current?.video;

      // Lowered readyState to 2 so it starts faster on mobile!
      if (video && video.readyState >= 2 && video.videoWidth > 0 && !isProcessingRef.current) {
        isProcessingRef.current = true;
        
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let phoneDetected = false;
        let isEyesOpen = true;

        try {
          // 1. PHONE DETECTION
          const objects = await objectDetector.detect(video);
          objects.forEach(obj => {
            if (obj.class === 'cell phone' || obj.class === 'bottle') {
              if (obj.class === 'cell phone') phoneDetected = true;
              ctx.strokeStyle = '#dc2626';
              ctx.lineWidth = 4;
              ctx.strokeRect(...obj.bbox);
              ctx.fillStyle = '#dc2626';
              ctx.font = 'bold 20px Arial';
              ctx.fillText(`${obj.class.toUpperCase()} ${Math.round(obj.score * 100)}%`, obj.bbox[0], obj.bbox[1] > 20 ? obj.bbox[1] - 5 : 20);
            }
          });

          // 2. DROWSINESS DETECTION (EAR)
          const faces = await faceDetector.estimateFaces(video);
          if (faces.length > 0) {
            const keypoints = faces[0].keypoints;
            const leftV = getDistance(keypoints[160], keypoints[144]) + getDistance(keypoints[158], keypoints[153]);
            const leftH = getDistance(keypoints[33], keypoints[133]);
            const leftEAR = leftV / (2.0 * leftH);

            const rightV = getDistance(keypoints[385], keypoints[380]) + getDistance(keypoints[387], keypoints[373]);
            const rightH = getDistance(keypoints[362], keypoints[263]);
            const rightEAR = rightV / (2.0 * rightH);

            const EAR = (leftEAR + rightEAR) / 2.0;
            
            // Bypass React state - update the DOM text directly for 60fps smoothness!
            if (earTextRef.current) earTextRef.current.innerText = EAR.toFixed(2);
            
            if (EAR < 0.40) isEyesOpen = false; // Tweak this number to your face
          }
        } catch (err) { console.error(err); }

        // ALARMS & TIMERS
        let phoneAlarm = false;
        if (phoneDetected) {
          if (!phoneStartRef.current) phoneStartRef.current = Date.now();
          else if ((Date.now() - phoneStartRef.current) / 1000 > 1.5) { phoneAlarm = true; playBeep(1000, 150); }
        } else { phoneStartRef.current = null; }
        
        let drowsyAlarm = false;
        if (!isEyesOpen) {
          if (!eyesClosedStartRef.current) eyesClosedStartRef.current = Date.now();
          else if ((Date.now() - eyesClosedStartRef.current) / 1000 > 1.5) { drowsyAlarm = true; playBeep(1200, 120); }
        } else { eyesClosedStartRef.current = null; }

        let currentStatus = "SAFE";
        let msg = "MONITORING DRIVER";

        if (phoneAlarm) { currentStatus = "PHONE DETECTED"; msg = "PHONE DETECTED (DISTRACTION)"; } 
        else if (drowsyAlarm) { currentStatus = "DROWSY"; msg = "DROWSINESS DETECTED!"; } 

        // ONLY UPDATE REACT IF THE STATUS ACTUALLY CHANGES (Saves CPU!)
        if (currentStatus !== lastStatusRef.current) {
          setIsDanger(currentStatus !== "SAFE");
          setAlertMessage(msg);
          lastStatusRef.current = currentStatus;
          if (userId) supabase.from('profiles').update({ ai_status: currentStatus }).eq('id', userId).then();
        }

        if (isEyesOpen !== lastEyesOpenRef.current) {
          setEyesOpen(isEyesOpen);
          lastEyesOpenRef.current = isEyesOpen;
        }

        isProcessingRef.current = false;
      }
      
      requestAnimationFrame(startDetectionLoop);
    };

    initAI();

    return () => { isActive = false; };
  }, [userId]);

  return (
    <div className={`absolute bottom-6 right-6 z-[999] bg-gray-900/95 backdrop-blur border-2 p-5 rounded-3xl w-[640px] transition-all duration-300 ${isDanger ? 'border-red-600 shadow-[0_0_60px_rgba(220,38,38,0.7)] scale-[1.02]' : 'border-blue-500/50 shadow-2xl'}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-black text-white text-lg tracking-widest uppercase">MotionX</h3>
        
        <div className="flex items-center gap-3">
          <span className="text-gray-400 font-mono text-sm font-bold tracking-widest">
            LOGIC: 
            <span className={eyesOpen ? "text-green-500 ml-2" : "text-red-500 ml-2 font-black animate-pulse"}>
              {eyesOpen ? "(OPEN)" : "(CLOSED)"} [EAR: <span ref={earTextRef}>0.00</span>]
            </span>
          </span>
        </div>

        <span className={`text-sm font-black ${aiStatus.includes("ACTIVE") ? 'text-green-500 animate-pulse' : 'text-yellow-500 animate-pulse'}`}>
          {aiStatus}
        </span>
      </div>
      <div className="relative rounded-2xl overflow-hidden border-2 border-gray-700 bg-black aspect-video shadow-inner">
        <Webcam ref={webcamRef} audio={false} className="absolute top-0 left-0 w-full h-full object-cover" mirrored={true} />
        {/* ADDED CSS MIRRORING SO BOUNDING BOXES ALIGN CORRECTLY */}
        <canvas ref={canvasRef} style={{ transform: 'scaleX(-1)' }} className="absolute top-0 left-0 w-full h-full z-10" />
      </div>
      <div className={`mt-5 text-center text-sm font-black p-4 rounded-xl tracking-widest transition-colors ${isDanger ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-gray-400'}`}>
        {alertMessage}
      </div>
    </div>
  );
    }
          
