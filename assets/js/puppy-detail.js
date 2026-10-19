(function () {
  'use strict';

  const header = document.querySelector('.site-header');
  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-navigation');
  const page = document.getElementById('puppy-profile');
  const notFound = document.getElementById('puppy-not-found');
  const year = document.getElementById('year');
  const galleryStage = document.getElementById('gallery-stage');
  const galleryMainImage = document.getElementById('puppy-image');
  const galleryOpenButton = document.getElementById('gallery-open');
  const galleryZoomButton = document.getElementById('gallery-zoom');
  const galleryPreviousButton = document.getElementById('gallery-prev');
  const galleryNextButton = document.getElementById('gallery-next');
  const galleryThumbnails = document.getElementById('puppy-gallery-thumbnails');
  const galleryCounter = document.getElementById('gallery-counter');
  const galleryModal = document.getElementById('puppy-gallery-modal');
  const galleryModalImage = document.getElementById('gallery-modal-image');
  const galleryModalCaption = document.getElementById('gallery-modal-caption');
  const galleryModalCounter = document.getElementById('gallery-modal-counter');
  const galleryModalClose = document.getElementById('gallery-modal-close');
  const galleryModalPrevious = document.getElementById('gallery-modal-prev');
  const galleryModalNext = document.getElementById('gallery-modal-next');

  if (year) year.textContent = new Date().getFullYear();

  function syncDashboardLink() {
    let loggedIn = false;
    try {
      const session = JSON.parse(window.localStorage.getItem('papillon_session_v1') || 'null');
      loggedIn = Boolean(session && session.loggedIn && session.email);
    } catch (_) { loggedIn = false; }
    document.querySelectorAll('.nav-contact').forEach(function (link) {
      if (!link.dataset.guestHref) link.dataset.guestHref = link.getAttribute('href') || '#contact';
      if (loggedIn) {
        link.href = '/dashboard';
        link.innerHTML = 'Go to dashboard <span aria-hidden="true">↗</span>';
      } else {
        link.href = link.dataset.guestHref;
        link.innerHTML = 'Let\'s talk <span aria-hidden="true">↗</span>';
      }
    });
  }
  syncDashboardLink();
  window.addEventListener('storage', function (event) {
    if (event.key === 'papillon_session_v1') syncDashboardLink();
  });


  function closeMenu() {
    if (!header || !menuToggle) return;
    header.classList.remove('menu-active');
    document.body.classList.remove('menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
  }

  if (header && menuToggle && nav) {
    menuToggle.addEventListener('click', function () {
      const willOpen = menuToggle.getAttribute('aria-expanded') !== 'true';
      menuToggle.setAttribute('aria-expanded', String(willOpen));
      menuToggle.setAttribute('aria-label', willOpen ? 'Close navigation menu' : 'Open navigation menu');
      header.classList.toggle('menu-active', willOpen);
      document.body.classList.toggle('menu-open', willOpen);
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });
    document.addEventListener('click', function (event) {
      if (header.classList.contains('menu-active') && !header.contains(event.target)) closeMenu();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 760) closeMenu();
    });
  }

  const pathParts = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const pathSlug = pathParts.length ? pathParts[pathParts.length - 1].toLowerCase() : '';
  const querySlug = new URLSearchParams(window.location.search).get('slug');
  const slug = (querySlug || pathSlug).toLowerCase();
  let puppy = null;

  function putText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function waitForImageReady(image, timeoutMs) {
    timeoutMs = timeoutMs || 12000;
    if (!image || !image.getAttribute('src')) return Promise.resolve(true);
    if (image.complete) return Promise.resolve(image.naturalWidth > 0);

    return new Promise(function (resolve) {
      let settled = false;
      let timer = null;
      function finish(loaded) {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        resolve(Boolean(loaded));
      }
      function onLoad() { finish(image.naturalWidth > 0); }
      function onError() { finish(false); }
      image.addEventListener('load', onLoad);
      image.addEventListener('error', onError);
      timer = window.setTimeout(function () { finish(image.complete && image.naturalWidth > 0); }, timeoutMs);
      // The image may have resolved between the initial check and listener registration.
      if (image.complete) finish(image.naturalWidth > 0);
    });
  }

  function waitForPaint() {
    return new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  let galleryItems = [];
  let galleryIndex = 0;

  function wrapGalleryIndex(index) {
    if (!galleryItems.length) return 0;
    return (index + galleryItems.length) % galleryItems.length;
  }

  function setGalleryImage(index, focusThumbnail) {
    if (!galleryItems.length) return;
    galleryIndex = wrapGalleryIndex(index);
    const item = galleryItems[galleryIndex];
    if (galleryMainImage) {
      if (galleryStage) galleryStage.classList.add('is-loading');
      galleryMainImage.src = item.src;
      galleryMainImage.alt = item.alt;
      galleryMainImage.loading = galleryIndex === 0 ? 'eager' : 'lazy';
      galleryMainImage.style.visibility = 'visible';
      galleryMainImage.closest('.profile-photo-frame')?.classList.remove('profile-photo-unavailable');
    }
    if (galleryCounter) galleryCounter.textContent = 'Photo ' + (galleryIndex + 1) + ' of ' + galleryItems.length;
    if (galleryThumbnails) {
      const buttons = galleryThumbnails.querySelectorAll('.gallery-thumbnail');
      buttons.forEach(function (button, indexFromButton) {
        const active = indexFromButton === galleryIndex;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        if (active && focusThumbnail) button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      });
    }
    if (galleryModal && galleryModal.open) updateGalleryModal();
  }

  function updateGalleryModal() {
    if (!galleryItems.length || !galleryModalImage) return;
    const item = galleryItems[galleryIndex];
    galleryModalImage.src = item.src;
    galleryModalImage.alt = item.alt;
    if (galleryModalCaption) galleryModalCaption.textContent = item.alt;
    if (galleryModalCounter) galleryModalCounter.textContent = (galleryIndex + 1) + ' / ' + galleryItems.length;
  }

  function openGalleryModal() {
    if (!galleryModal || !galleryItems.length) return;
    updateGalleryModal();
    if (typeof galleryModal.showModal === 'function') {
      if (!galleryModal.open) galleryModal.showModal();
    } else {
      galleryModal.setAttribute('open', 'open');
      document.body.classList.add('gallery-preview-open');
    }
  }

  function closeGalleryModal() {
    if (!galleryModal) return;
    if (typeof galleryModal.close === 'function' && galleryModal.open) galleryModal.close();
    else galleryModal.removeAttribute('open');
    document.body.classList.remove('gallery-preview-open');
  }

  function buildGallery(items) {
    galleryItems = Array.isArray(items) && items.length ? items.slice() : [];
    if (!galleryItems.length && puppy && puppy.image) {
      galleryItems = [{ src: puppy.image, alt: puppy.imageAlt || 'Papillon puppy photo' }];
    }
    if (!galleryItems.length) return;

    if (galleryThumbnails) {
      galleryThumbnails.replaceChildren();
      galleryItems.forEach(function (item, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gallery-thumbnail is-loading';
        button.setAttribute('aria-label', 'Show photo ' + (index + 1) + ': ' + item.alt);
        button.setAttribute('aria-pressed', 'false');
        const thumb = document.createElement('img');
        thumb.alt = '';
        thumb.loading = 'lazy';
        thumb.decoding = 'async';
        thumb.draggable = false;
        thumb.addEventListener('load', function () {
          button.classList.remove('is-loading');
          button.classList.add('is-loaded');
        }, { once: true });
        thumb.addEventListener('error', function () {
          button.classList.remove('is-loading');
          button.classList.add('gallery-thumbnail-unavailable');
          button.setAttribute('aria-label', 'Photo ' + (index + 1) + ' unavailable');
        }, { once: true });
        button.appendChild(thumb);
        button.addEventListener('click', function () { setGalleryImage(index, true); });
        galleryThumbnails.appendChild(button);
        thumb.src = item.src;
      });
    }

    // Load the active image first; thumbnails are lazy-loaded to keep mobile data use down.
    setGalleryImage(0, false);
  }

  async function initializePuppyPage() {
    try {
      try {
        const controller = new AbortController();
        const requestTimeout = window.setTimeout(function () { controller.abort(); }, 15000);
        let response;
        let result;
        try {
          response = await fetch('/api/puppies?slug=' + encodeURIComponent(slug), {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal
          });
          result = await response.json().catch(() => ({}));
        } finally {
          window.clearTimeout(requestTimeout);
        }
      if (response.ok && result.puppy && result.puppy.image) {
        const record = result.puppy;
        const imageAlt = record.imageAlt || ((record.name || 'Papillon') + ' puppy');
        const extraGallery = Array.isArray(record.gallery) ? record.gallery.map(function (entry, index) {
          if (typeof entry === 'string') return { src: entry, alt: (record.name || 'Puppy') + ' photo ' + (index + 2) };
          return entry && typeof entry.src === 'string' && entry.src ? {
            src: entry.src,
            alt: entry.alt || entry.name || ((record.name || 'Puppy') + ' photo ' + (index + 2))
          } : null;
        }).filter(Boolean) : [];
        const numericPrice = Number(record.price);
        const priceText = 'C$' + new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(Number.isFinite(numericPrice) ? numericPrice : 0);
        puppy = {
          // Keep the listing slug so puppy-specific links use the current record URL.
          slug: record.slug || slug,
          name: record.name || 'Puppy',
          gender: record.gender || '',
          age: record.age || '',
          price: priceText,
          status: record.status || 'Looking for a home',
          personality: record.personality || 'A lovely little companion',
          headline: 'Meet ' + (record.name || 'your puppy') + ',',
          headlineEm: 'your new best friend.',
          summary: record.summary || '',
          story: record.details || record.summary || '',
          traits: [record.personality || 'Raised with care', record.status || 'Puppy profile', 'Papillon companion'],
          image: record.image,
          imageAlt,
          gallery: [{ src: record.image, alt: imageAlt }].concat(extraGallery.filter(function (entry) { return entry.src !== record.image; }))
        };
        }
      } catch (_) {
        // Missing or slow API connections are treated as unavailable, not as demo data.
      }

      if (!puppy) {
    if (page) page.hidden = true;
    if (notFound) notFound.hidden = false;
    document.title = 'Puppy Not Found | Papillon & Co.';
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', 'This puppy profile could not be found. Browse available Papillon puppies.');
  } else {
    if (page) page.hidden = false;
    document.title = 'Meet ' + puppy.name + ' | Papillon & Co.';
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', puppy.summary + ' Learn more about ' + puppy.name + ' at Papillon & Co.');

    putText('breadcrumb-puppy-name', puppy.name);
    putText('puppy-name', puppy.name);
    putText('puppy-description', puppy.summary);
    putText('puppy-price', puppy.price);
    putText('puppy-age', puppy.age);
    putText('puppy-gender-fact', puppy.gender);
    const genderIcon = document.getElementById('puppy-gender-icon');
    if (genderIcon) {
      const normalizedGender = String(puppy.gender || '').trim().toLowerCase();
      if (/^(male|boy|m)(\b|$)/.test(normalizedGender)) genderIcon.textContent = '♂';
      else if (/^(female|girl|f)(\b|$)/.test(normalizedGender)) genderIcon.textContent = '♀';
      else genderIcon.textContent = '⚥';
    }
    putText('puppy-status', puppy.status);
    putText('puppy-story-heading', puppy.headline);
    putText('puppy-story-heading-em', puppy.headlineEm);
    putText('puppy-long-description', puppy.story);

    if (galleryMainImage) {
      galleryMainImage.addEventListener('load', function () {
        galleryMainImage.style.visibility = 'visible';
        const frame = galleryMainImage.closest('.profile-photo-frame');
        if (frame) frame.classList.remove('is-loading', 'profile-photo-unavailable');
      });
      galleryMainImage.addEventListener('error', function () {
        galleryMainImage.alt = 'Puppy photo is currently unavailable';
        galleryMainImage.style.visibility = 'hidden';
        const frame = galleryMainImage.closest('.profile-photo-frame');
        if (frame) frame.classList.remove('is-loading');
        if (frame) frame.classList.add('profile-photo-unavailable');
      });
    }
    buildGallery(puppy.gallery || [{ src: puppy.image, alt: puppy.imageAlt }]);
    const mainImageLoaded = await waitForImageReady(galleryMainImage, 12000);
    if (!mainImageLoaded && galleryMainImage) {
      galleryMainImage.alt = 'Puppy photo is currently unavailable';
      galleryMainImage.style.visibility = 'hidden';
      const frame = galleryMainImage.closest('.profile-photo-frame');
      if (frame) frame.classList.add('profile-photo-unavailable');
    }

    if (galleryOpenButton) galleryOpenButton.addEventListener('click', openGalleryModal);
    if (galleryZoomButton) galleryZoomButton.addEventListener('click', openGalleryModal);
    if (galleryPreviousButton) galleryPreviousButton.addEventListener('click', function () { setGalleryImage(galleryIndex - 1, false); });
    if (galleryNextButton) galleryNextButton.addEventListener('click', function () { setGalleryImage(galleryIndex + 1, false); });
    if (galleryModalClose) galleryModalClose.addEventListener('click', closeGalleryModal);
    if (galleryModalPrevious) galleryModalPrevious.addEventListener('click', function () { setGalleryImage(galleryIndex - 1, false); });
    if (galleryModalNext) galleryModalNext.addEventListener('click', function () { setGalleryImage(galleryIndex + 1, false); });

    if (galleryModal) {
      galleryModal.addEventListener('click', function (event) {
        if (event.target === galleryModal) closeGalleryModal();
      });
      galleryModal.addEventListener('close', function () { document.body.classList.remove('gallery-preview-open'); });
      galleryModal.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowLeft') { event.preventDefault(); setGalleryImage(galleryIndex - 1, false); }
        if (event.key === 'ArrowRight') { event.preventDefault(); setGalleryImage(galleryIndex + 1, false); }
      });
    }

    // Swipe the main gallery on touch devices. Desktop users use the arrow controls.
    let touchStartX = 0;
    let touchStartY = 0;
    if (galleryStage) {
      galleryStage.addEventListener('touchstart', function (event) {
        if (!event.touches || event.touches.length !== 1) return;
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
      }, { passive: true });
      galleryStage.addEventListener('touchend', function (event) {
        if (!event.changedTouches || event.changedTouches.length !== 1) return;
        const deltaX = event.changedTouches[0].clientX - touchStartX;
        const deltaY = event.changedTouches[0].clientY - touchStartY;
        if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
          setGalleryImage(galleryIndex + (deltaX < 0 ? 1 : -1), true);
        }
      }, { passive: true });
    }
    if (galleryModal) {
      let modalTouchStartX = 0;
      let modalTouchStartY = 0;
      galleryModal.addEventListener('touchstart', function (event) {
        if (!event.touches || event.touches.length !== 1) return;
        modalTouchStartX = event.touches[0].clientX;
        modalTouchStartY = event.touches[0].clientY;
      }, { passive: true });
      galleryModal.addEventListener('touchend', function (event) {
        if (!event.changedTouches || event.changedTouches.length !== 1) return;
        const deltaX = event.changedTouches[0].clientX - modalTouchStartX;
        const deltaY = event.changedTouches[0].clientY - modalTouchStartY;
        if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
          setGalleryImage(galleryIndex + (deltaX < 0 ? 1 : -1), false);
        }
      }, { passive: true });
    }

    const traits = document.getElementById('puppy-traits');
    if (traits) {
      traits.replaceChildren();
      puppy.traits.forEach(function (trait) {
        const item = document.createElement('li');
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '✦';
        item.append(icon, document.createTextNode(trait));
        traits.appendChild(item);
      });
    }

    const contactUrl = '/contact/' + encodeURIComponent(puppy.slug);
    const cta = document.getElementById('puppy-enquiry-cta');
    if (cta) {
      cta.href = contactUrl;
      cta.setAttribute('aria-label', 'Contact us about ' + puppy.name);
    }
    const contactLink = document.getElementById('puppy-contact-link');
    if (contactLink) contactLink.href = contactUrl;
      }
    } catch (error) {
      console.error('Unable to render puppy profile:', error);
      if (page) page.hidden = true;
      if (notFound) {
        notFound.hidden = false;
        const heading = notFound.querySelector('h1');
        const message = notFound.querySelector('.not-found-inner > p:not(.eyebrow)');
        if (heading) heading.textContent = 'We could not load that puppy.';
        if (message) message.textContent = 'The puppy details are temporarily unavailable. Please try again or browse available puppies.';
      }
      document.title = 'Puppy Profile Unavailable | Papillon & Co.';
    } finally {
      // Let the DOM and main photo state paint before lifting the full-screen loader.
      await waitForPaint();
      window.dispatchEvent(new Event('papillon:puppy-detail-ready'));
    }
  }
  initializePuppyPage();


})();
