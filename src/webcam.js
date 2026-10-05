// --- Create the element that will display the camera feed ---
// Creating a video element does not turn on the camera.
export function createWebcam() {
  const video = document.createElement('video');
  video.id = 'webcam';
  video.autoplay = true;
  video.muted = true;
  // Keep the video inside the page on phones instead of opening fullscreen.
  video.playsInline = true;
  document.body.prepend(video);
  return video;
}

// --- Ask for camera access and connect the live feed ---
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access needs localhost or HTTPS.');
  }
  // Request video only. The browser may choose a different resolution.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  // srcObject connects a live stream; a normal src would point to a video file.
  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    stopCamera(video);
    throw error;
  }
}

// --- Release the camera hardware ---
// Pausing a video alone does not stop its camera stream.
export function stopCamera(video) {
  video.srcObject?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
}
