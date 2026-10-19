(function () {
  'use strict';

  const header = document.querySelector('.site-header');
  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-navigation');
  const navLinks = nav ? nav.querySelectorAll('a[href]') : [];
  const sectionNavLinks = nav ? nav.querySelectorAll('a[href^="#"]') : [];
  const year = document.getElementById('year');

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


  // Puppy cards keep clean slug URLs in both local development and production.

  function closeMenu() {
    if (!header || !menuToggle) return;
    header.classList.remove('menu-active');
    document.body.classList.remove('menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
  }

  if (menuToggle && header) {
    menuToggle.addEventListener('click', function () {
      const willOpen = menuToggle.getAttribute('aria-expanded') !== 'true';
      menuToggle.setAttribute('aria-expanded', String(willOpen));
      menuToggle.setAttribute('aria-label', willOpen ? 'Close navigation menu' : 'Open navigation menu');
      header.classList.toggle('menu-active', willOpen);
      document.body.classList.toggle('menu-open', willOpen);
    });

    navLinks.forEach(function (link) {
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

  // Public listing pagination. All records still come from Firestore; only the
  // visible slice is rendered on each page.
  const puppyGrid = document.getElementById('puppy-grid');
  const puppyPagination = document.getElementById('puppy-pagination');
  const puppyPaginationSummary = document.getElementById('puppy-pagination-summary');
  const puppyPageNumbers = document.getElementById('puppy-page-numbers');
  const puppyPrevPage = document.getElementById('puppy-prev-page');
  const puppyNextPage = document.getElementById('puppy-next-page');
  const PUPPIES_PER_PAGE = 6;
  let publicPuppies = [];
  let currentPuppyPage = 1;

  function setListingMessage(message) {
    if (puppyGrid) {
      puppyGrid.replaceChildren();
      const notice = document.createElement('p');
      notice.className = 'availability-note';
      notice.textContent = message;
      puppyGrid.appendChild(notice);
    }
    if (puppyPagination) puppyPagination.hidden = true;
  }

  function getPageItems(currentPage, totalPages) {
    // Keep the control bar from overflowing narrow phones while showing the
    // usual nearby page numbers on wider screens.
    if (window.innerWidth <= 390 && totalPages > 4) {
      if (currentPage <= 2) return [1, 2, 'ellipsis', totalPages];
      if (currentPage >= totalPages - 1) return [1, 'ellipsis', totalPages - 1, totalPages];
      return [1, 'ellipsis', currentPage, 'ellipsis', totalPages];
    }
    if (totalPages <= 5) return Array.from({ length: totalPages }, function (_, index) { return index + 1; });
    if (currentPage <= 3) return [1, 2, 3, 4, 'ellipsis', totalPages];
    if (currentPage >= totalPages - 2) return [1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages];
  }

  function changePuppyPage(nextPage) {
    const totalPages = Math.ceil(publicPuppies.length / PUPPIES_PER_PAGE);
    if (!totalPages) return;
    const safePage = Math.max(1, Math.min(totalPages, Number(nextPage) || 1));
    if (safePage === currentPuppyPage) return;
    currentPuppyPage = safePage;
    renderPuppyPage();
    const section = document.getElementById('puppies');
    if (section) section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function renderPuppyPagination(totalPages) {
    if (!puppyPagination || !puppyPaginationSummary || !puppyPageNumbers || !puppyPrevPage || !puppyNextPage) return;
    if (!publicPuppies.length) {
      puppyPagination.hidden = true;
      return;
    }

    puppyPagination.hidden = false;
    const firstItem = (currentPuppyPage - 1) * PUPPIES_PER_PAGE + 1;
    const lastItem = Math.min(currentPuppyPage * PUPPIES_PER_PAGE, publicPuppies.length);
    puppyPaginationSummary.textContent = 'Showing ' + firstItem + '–' + lastItem + ' of ' + publicPuppies.length + (publicPuppies.length === 1 ? ' puppy' : ' puppies');
    puppyPrevPage.disabled = currentPuppyPage <= 1;
    puppyNextPage.disabled = currentPuppyPage >= totalPages;
    puppyPageNumbers.replaceChildren();

    if (totalPages <= 1) {
      puppyPagination.classList.add('puppy-pagination-single-page');
      puppyPagination.querySelector('.puppy-pagination-nav').hidden = true;
      return;
    }
    puppyPagination.classList.remove('puppy-pagination-single-page');
    puppyPagination.querySelector('.puppy-pagination-nav').hidden = false;

    getPageItems(currentPuppyPage, totalPages).forEach(function (pageItem) {
      if (pageItem === 'ellipsis') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'puppy-pagination-ellipsis';
        ellipsis.textContent = '…';
        ellipsis.setAttribute('aria-hidden', 'true');
        puppyPageNumbers.appendChild(ellipsis);
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'puppy-pagination-number';
      button.textContent = String(pageItem);
      button.setAttribute('aria-label', 'Page ' + pageItem);
      if (pageItem === currentPuppyPage) {
        button.classList.add('is-current');
        button.setAttribute('aria-current', 'page');
        button.disabled = true;
      }
      button.addEventListener('click', function () { changePuppyPage(pageItem); });
      puppyPageNumbers.appendChild(button);
    });
  }

  function renderPuppyPage() {
    if (!puppyGrid) return;
    puppyGrid.replaceChildren();
    if (!publicPuppies.length) {
      setListingMessage('No puppy listings are available right now. Please check back soon.');
      return;
    }

    const totalPages = Math.ceil(publicPuppies.length / PUPPIES_PER_PAGE);
    currentPuppyPage = Math.max(1, Math.min(currentPuppyPage, totalPages));
    const pageStart = (currentPuppyPage - 1) * PUPPIES_PER_PAGE;
    const visiblePuppies = publicPuppies.slice(pageStart, pageStart + PUPPIES_PER_PAGE);

    visiblePuppies.forEach(function (item) {
      const card = document.createElement('article');
      card.className = 'puppy-card';
      const profileLink = document.createElement('a');
      profileLink.className = 'puppy-card-link';
      profileLink.href = '/' + String(item.slug || '').replace(/^\/+|\/+$/g, '');
      profileLink.setAttribute('aria-label', 'View ' + item.name + "'s puppy profile");

      const imageWrap = document.createElement('div');
      imageWrap.className = 'puppy-image-wrap';
      const image = document.createElement('img');
      if (typeof item.image === 'string' && item.image.startsWith('data:image/jpeg;base64,')) image.src = item.image;
      image.alt = item.imageAlt || (item.name + ' Papillon puppy');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', function () {
        image.removeAttribute('src');
        image.alt = 'Puppy image unavailable';
        imageWrap.classList.add('image-unavailable');
      }, { once: true });
      const status = document.createElement('span');
      status.className = 'puppy-status status-available';
      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      status.append(dot, document.createTextNode(item.status || 'Looking for a home'));
      imageWrap.append(image, status);

      const body = document.createElement('div');
      body.className = 'puppy-card-body';
      const titleRow = document.createElement('div');
      titleRow.className = 'puppy-title-row';
      const title = document.createElement('h3');
      title.textContent = item.name || 'Puppy';
      const gender = document.createElement('span');
      gender.className = 'puppy-gender';
      gender.textContent = item.gender || '';
      titleRow.append(title, gender);
      const meta = document.createElement('div');
      meta.className = 'puppy-meta';
      const age = document.createElement('span');
      age.className = 'puppy-age';
      age.textContent = item.age || '';
      const price = document.createElement('strong');
      price.className = 'puppy-price';
      const numericPrice = Number(item.price);
      price.textContent = Number.isFinite(numericPrice) ? 'C$' + new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(numericPrice) : String(item.price || '');
      meta.append(age, price);
      body.append(titleRow, meta);
      profileLink.append(imageWrap, body);

      const favorite = document.createElement('button');
      favorite.className = 'favorite-button';
      favorite.type = 'button';
      favorite.setAttribute('aria-label', 'Save ' + (item.name || 'puppy') + ' to favorites');
      favorite.setAttribute('aria-pressed', 'false');
      const heart = document.createElement('span');
      heart.setAttribute('aria-hidden', 'true'); heart.textContent = '♡'; favorite.appendChild(heart);
      card.append(profileLink, favorite);
      puppyGrid.appendChild(card);
    });

    renderPuppyPagination(totalPages);
  }

  function renderManagedListings(items) {
    publicPuppies = Array.isArray(items) ? items : [];
    currentPuppyPage = 1;
    renderPuppyPage();
  }

  if (puppyGrid) {
    puppyGrid.addEventListener('click', function (event) {
      const button = event.target.closest('.favorite-button');
      if (!button || !puppyGrid.contains(button)) return;
      const saved = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(saved));
      const currentLabel = button.getAttribute('aria-label') || 'puppy';
      const name = currentLabel.replace(/^(Save|Remove) /, '').replace(/ (to|from) favorites$/, '');
      button.setAttribute('aria-label', (saved ? 'Remove ' : 'Save ') + name + ' ' + (saved ? 'from' : 'to') + ' favorites');
      const icon = button.querySelector('span');
      if (icon) icon.textContent = saved ? '♥' : '♡';
    });
  }

  if (puppyPrevPage) puppyPrevPage.addEventListener('click', function () { changePuppyPage(currentPuppyPage - 1); });
  if (puppyNextPage) puppyNextPage.addEventListener('click', function () { changePuppyPage(currentPuppyPage + 1); });

  async function loadPublicPuppies() {
    if (!puppyGrid) return;
    try {
      const response = await fetch('/api/puppies', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.puppies)) throw new Error(result.error || 'Puppy listings are temporarily unavailable.');
      renderManagedListings(result.puppies);
    } catch (_) {
      setListingMessage('Puppy listings are temporarily unavailable. Please check back soon.');
    }
  }
  loadPublicPuppies();

  // Keep the active navigation item in sync with the section in view.
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  if ('IntersectionObserver' in window && sections.length && sectionNavLinks.length) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        sectionNavLinks.forEach(function (link) {
          const active = link.getAttribute('href') === '#' + entry.target.id;
          link.classList.toggle('active', active);
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });
    sections.forEach(function (section) { observer.observe(section); });
  }


})();
