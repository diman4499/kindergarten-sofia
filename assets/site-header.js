(() => {
  'use strict';
  const header = document.querySelector('.site-header');
  if (!header) return;
  const updateHeight = () => document.documentElement.style.setProperty(
    '--site-header-height', header.getBoundingClientRect().height + 'px'
  );
  updateHeight();
  if ('ResizeObserver' in window) new ResizeObserver(updateHeight).observe(header);
  else window.addEventListener('resize', updateHeight);
})();
