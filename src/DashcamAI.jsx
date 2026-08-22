import React, { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as blazeface from "@tensorflow-models/blazeface";

export default function DashcamAI() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const [aiStatus, setAiStatus] = useState("LOADING NEURAL NET...");
  const [isDanger, setIsDanger] = useState(false);
  const [alertMessage, setAlertMessage] = useState("MONITORING DRIVER");

  // Python Script Equivalent Timers
  const phoneStartRef = useRef(null);
  const eyesClosedStartRef = useRef(null);

  // Recreate Python's winsound.Beep() using the browser's Web Audio API
  const playBeep = (freq, durationMs) => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
    oscillator.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + (durationMs / 1000));
  };

  useEffect(() => {
    const runAI = async () => {
      await tf.ready();
      // Load both YOLO equivalent (coco-ssd) and Haar Cascade equivalent (blazeface)
      const objectModel = await cocoSsd.load();
      const faceModel = await blazeface.load();
      setAiStatus("● AI ACTIVE");

      // Scan every 500ms to keep laptop performance high
      setInterval(() => {
        detect(objectModel, faceModel);
      }, 500); 
    };

    runAI();
  }, []);

  const detect = async (objectModel, faceModel) => {
    if (
      typeof webcamRef.current !== "undefined" &&
      webcamRef.current !== null &&
      webcamRef.current.video.readyState === 4
    ) {
      const video = webcamRef.current.video;
      const videoWidth = webcamRef.current.video.videoWidth;
      const videoHeight = webcamRef.current.video.videoHeight;

      webcamRef.current.video.width = videoWidth;
      webcamRef.current.video.height = videoHeight;
      canvasRef.current.width = videoWidth;
      canvasRef.current.height = videoHeight;

      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, videoWidth, videoHeight);

      // ==========================================
      // 1. YOLO PHONE & BOTTLE DETECTION
      // ==========================================
      const objPredictions = await objectModel.detect(video);
      let phoneDetected = false;

      objPredictions.forEach(prediction => {
        const [x, y, width, height] = prediction.bbox;
        const label = prediction.class;
        const conf = prediction.score;

        if (['person', 'cell phone', 'bottle'].includes(label) && conf > 0.5) {
          let color = '#22c55e'; // Green for person
          if (label === 'cell phone') color = '#dc2626'; // Red for phone
          if (label === 'bottle') color = '#3b82f6'; // Blue for bottle

          // Draw the boxes matching your Python script
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);
          ctx.fillStyle = color;
          ctx.font = 'bold 16px Arial';
          ctx.fillText(`${label.toUpperCase()} ${conf.toFixed(2)}`, x, y > 15 ? y - 5 : 15);

          if (label === 'cell phone') phoneDetected = true;
        }
      });

      // Phone Timer Logic
      let phoneAlarm = false;
      if (phoneDetected) {
        if (!phoneStartRef.current) {
          phoneStartRef.current = Date.now();
        } else {
          const elapsed = (Date.now() - phoneStartRef.current) / 1000;
          if (elapsed > 5) {
            phoneAlarm = true;
            playBeep(1000, 150); // Matches winsound.Beep(1000, 150)
          }
        }
      } else {
        phoneStartRef.current = null;
      }

      // ==========================================
      // 2. DROWSINESS (FACE/EYES) DETECTION
      // ==========================================
      const facePredictions = await faceModel.estimateFaces(video, false);
      let eyesDetected = facePredictions.length > 0; // Checks if face/eyes are visible to camera
      let drowsyAlarm = false;

      if (eyesDetected) {
        eyesClosedStartRef.current = null;
      } else {
        if (!eyesClosedStartRef.current) {
          eyesClosedStartRef.current = Date.now();
        } else {
          const elapsed = (Date.now() - eyesClosedStartRef.current) / 1000;
          if (elapsed > 10) {
            drowsyAlarm = true;
            playBeep(1200, 100); // Matches winsound.Beep(1200, 100)
          }
        }
      }

      // ==========================================
      // 3. UI DASHBOARD UPDATES
      // ==========================================
      if (phoneAlarm) {
        setIsDanger(true);
        setAlertMessage("PHONE DETECTED 5+ SEC!");
      } else if (drowsyAlarm) {
        setIsDanger(true);
        setAlertMessage("DROWSINESS DETECTED!");
      } else {
        setIsDanger(false);
        setAlertMessage("MONITORING DRIVER");
      }
    }
  };

  return (
    <div className={`absolute bottom-6 right-6 z-[999] bg-gray-900/95 backdrop-blur border-2 p-4 rounded-2xl w-80 transition-all duration-300 ${isDanger ? 'border-red-600 shadow-[0_0_40px_rgba(220,38,38,0.6)] scale-105' : 'border-blue-500/50 shadow-2xl'}`}>
      
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-bold text-white text-sm tracking-widest uppercase">Driver Cam</h3>
        <span className={`text-xs font-black animate-pulse ${isDanger ? 'text-red-500' : (aiStatus.includes("ACTIVE") ? 'text-green-500' : 'text-yellow-500')}`}>
          {aiStatus}
        </span>
      </div>
      
      {/* Video & Canvas Overlay Stack */}
      <div className="relative rounded-lg overflow-hidden border border-gray-700 bg-black aspect-video shadow-inner">
        <Webcam
          ref={webcamRef}
          audio={false}
          className="absolute top-0 left-0 w-full h-full object-cover"
          mirrored={true}
        />
        <canvas 
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full z-10" 
        />
      </div>
      
      {/* Status Bar */}
      <div className={`mt-4 text-center text-xs font-black p-3 rounded tracking-widest transition-colors ${isDanger ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-gray-400'}`}>
        {alertMessage}
      </div>

    </div>
  );
}