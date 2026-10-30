// Plays each project clip while it is on screen and pauses it when it scrolls away.
// Readers who prefer reduced motion get the poster and the controls only.
(() => {
  const clips = document.querySelectorAll('video[data-autoplay]');
  if (!clips.length || !('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const clip = entry.target;
      if (entry.isIntersecting) {
        clip.play().catch(error => console.warn(`Clip did not start: ${clip.currentSrc}`, error));
      } else {
        clip.pause();
      }
    }
  }, { threshold: 0.6 });
  clips.forEach(clip => observer.observe(clip));
})();
