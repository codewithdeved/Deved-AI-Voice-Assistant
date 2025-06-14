const container = document.querySelector('.app-container');
const globe = document.querySelector('.globe');

let currentRotateX = 0;
let currentRotateY = 0;
let targetRotateX = 0;
let targetRotateY = 0;
let isPaused = false;
let pauseTimeout = null;

function animate() {
    if (!isPaused) {
        const lerpFactor = 0.12; 
        currentRotateX += (targetRotateX - currentRotateX) * lerpFactor;
        currentRotateY += (targetRotateY - currentRotateY) * lerpFactor;

        currentRotateX = Math.round(currentRotateX * 1000) / 1000;
        currentRotateY = Math.round(currentRotateY * 1000) / 1000;

        globe.style.transform = `translate(-50%, -50%) rotateX(${currentRotateX}deg) rotateY(${currentRotateY}deg)`;
    }

    requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

container.addEventListener('mousemove', (e) => {
    isPaused = false;

    if (pauseTimeout) {
        clearTimeout(pauseTimeout);
    }

    pauseTimeout = setTimeout(() => {
        isPaused = true;
    }, 1000);

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;

    const maxDegrees = 360;
    targetRotateY = (x / (rect.width / 2)) * maxDegrees;
    targetRotateX = -(y / (rect.height / 2)) * maxDegrees;
});

container.addEventListener('mouseleave', () => {
    if (pauseTimeout) {
        clearTimeout(pauseTimeout);
    }

    isPaused = false;
    targetRotateX = 0;
    targetRotateY = 0;
});