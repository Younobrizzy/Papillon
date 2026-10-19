(function () {
  'use strict';

  const SESSION_KEY = 'papillon_session_v1';
  const PREFERENCES_KEY = 'papillon_preferences_v1';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const loginScreen = $('#login-screen');
  const loginForm = $('#login-form');
  const loginError = $('#login-error');
  const loginSubmit = $('#login-submit');
  const loginSubmitLabel = $('.login-submit-label');
  const passwordInput = $('#login-password');
  const passwordToggle = $('#password-toggle');
  const app = $('#dashboard-app');
  const authLoader = $('#dashboard-auth-loader');
  const authLoaderMessage = $('#dashboard-auth-loader-message');
  const sidebar = $('#dashboard-sidebar');
  const menuToggle = $('#mobile-menu-toggle');
  const sidebarBackdrop = $('#sidebar-backdrop');
  const userEmail = $('#user-email');
  const topbarTitle = $('#topbar-title');
  const listingView = $('#listings-view');
  const preferencesView = $('#preferences-view');
  const listingEditorView = $('#listing-editor-view');
  const listingList = $('#listing-list');
  const listingCount = $('#listing-count');
  const listingForm = $('#listing-form');
  const listingFormError = $('#listing-form-error');
  const confirmDialog = $('#confirm-dialog');
  const toast = $('#dashboard-toast');
  let listings = [];
  let listingsLoading = false;
  let listingsError = '';
  let toastTimeout = null;
  let pendingConfirmation = null;
  let currentEmail = '';
  let currentSiteOgImage = '';
  let auth = null;
  let signInWithEmailAndPassword = null;
  let onAuthStateChanged = null;
  let signOut = null;
  let isSubmittingLogin = false;
  let activePreferenceTab = 'site';
  const AUTH_TRANSITION_MIN_MS = 420;
  let authTransitionStartedAt = Date.now();
  let authTransitionToken = 0;

  function startAuthTransition(message) {
    authTransitionToken += 1;
    authTransitionStartedAt = Date.now();
    if (authLoader) {
      authLoader.classList.remove('is-hidden');
      authLoader.setAttribute('aria-hidden', 'false');
      authLoader.setAttribute('aria-busy', 'true');
    }
    if (authLoaderMessage && message) authLoaderMessage.textContent = message;
    document.body.setAttribute('aria-busy', 'true');
    return authTransitionToken;
  }

  function ensureAuthTransition(message) {
    const loaderIsHidden = !authLoader || authLoader.classList.contains('is-hidden');
    if (loaderIsHidden) return startAuthTransition(message);
    if (authLoaderMessage && message) authLoaderMessage.textContent = message;
    document.body.setAttribute('aria-busy', 'true');
    return authTransitionToken;
  }

  async function finishAuthTransition(token) {
    const expectedToken = token === undefined ? authTransitionToken : token;
    const remaining = Math.max(0, AUTH_TRANSITION_MIN_MS - (Date.now() - authTransitionStartedAt));
    if (remaining) await new Promise(resolve => window.setTimeout(resolve, remaining));
    if (expectedToken !== authTransitionToken) return;
    if (authLoader) {
      authLoader.classList.add('is-hidden');
      authLoader.setAttribute('aria-hidden', 'true');
      authLoader.setAttribute('aria-busy', 'false');
    }
    document.body.removeAttribute('aria-busy');
  }

  async function apiFetch(url, init = {}) {
    const headers = new Headers(init.headers || {});
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const user = auth && auth.currentUser;
    if (user) headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
    return fetch(url, { ...init, headers, credentials: 'same-origin' });
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }

  async function refreshListings() {
    listingsLoading = true;
    listingsError = '';
    renderListings();
    try {
      const response = await apiFetch('/api/puppies', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.puppies)) {
        throw new Error(result.error || 'Unable to load puppy listings. Please try again.');
      }
      listings = result.puppies;
    } catch (error) {
      listings = [];
      listingsError = error.message || 'Unable to load puppy listings.';
    } finally {
      listingsLoading = false;
      renderListings();
    }
  }

  async function fetchPuppyDetails(slug) {
    const response = await apiFetch('/api/puppies?slug=' + encodeURIComponent(slug), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.puppy) throw new Error(result.error || 'Unable to load this puppy.');
    return result.puppy;
  }

  async function savePuppyListing(item) {
    const response = await apiFetch('/api/puppies', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(item)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || 'Unable to save this puppy.');
    return result.puppy;
  }

  function slugify(value) {
    return String(value || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function safeImageURL(value) {
    const raw = String(value || '').trim();
    // Compressed uploads are stored as JPEG data URLs so listing photos can be previewed
    // and rendered by the existing front-end without a separate file server.
    if (/^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw)) return raw;
    try {
      const parsed = new URL(raw, window.location.origin);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (_) { return ''; }
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'C$0';
    return 'C$' + new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(number);
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  function isLoggedIn() {
    const session = readJSON(SESSION_KEY, null);
    return Boolean(session && session.loggedIn && session.email);
  }

  function getSession() {
    return readJSON(SESSION_KEY, null);
  }

  function setLoginLoading(isLoading) {
    if (!loginSubmit) return;
    loginSubmit.disabled = Boolean(isLoading);
    loginSubmit.classList.toggle('is-loading', Boolean(isLoading));
    loginSubmit.setAttribute('aria-busy', String(Boolean(isLoading)));
    if (loginSubmitLabel) loginSubmitLabel.textContent = isLoading ? 'Signing in…' : 'Continue';
  }

  function showLogin() {
    const transitionToken = ensureAuthTransition('Preparing sign-in…');
    setLoginLoading(false);
    if (loginScreen) loginScreen.hidden = false;
    if (app) app.hidden = true;
    closeMobileSidebar();
    document.body.classList.remove('dialog-open');
    void finishAuthTransition(transitionToken);
  }

  async function showApp() {
    const session = getSession();
    if (!session || !session.loggedIn) {
      showLogin();
      return;
    }

    const transitionToken = startAuthTransition('Getting your dashboard ready…');
    currentEmail = session.email;
    if (loginScreen) loginScreen.hidden = true;
    if (app) app.hidden = true;
    if (userEmail) userEmail.textContent = currentEmail;
    showView('listings');

    try {
      // Keep the dashboard covered until its first data requests complete, so
      // visitors never see an empty frame or a layout jump between login and app.
      await refreshListings();
      await loadPreferencesIntoForm();
    } catch (error) {
      console.error('Dashboard initial loading failed:', error);
    } finally {
      if (transitionToken === authTransitionToken) {
        if (app) app.hidden = false;
        await finishAuthTransition(transitionToken);
      }
    }
  }

  function closeMobileSidebar() {
    if (!app || !menuToggle) return;
    app.classList.remove('sidebar-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open dashboard menu');
    document.body.classList.remove('dialog-open');
  }

  function showView(viewName) {
    if (!['listings', 'preferences', 'editor'].includes(viewName)) viewName = 'listings';
    const isPreferences = viewName === 'preferences';
    const isEditor = viewName === 'editor';
    listingView.hidden = viewName !== 'listings';
    preferencesView.hidden = !isPreferences;
    listingEditorView.hidden = !isEditor;
    $$('.sidebar-nav-link[data-view]').forEach(button => {
      const active = button.dataset.view === (isEditor ? 'listings' : viewName);
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    topbarTitle.textContent = isPreferences ? 'Preferences' : isEditor ? ($('#listing-original-slug').value ? 'Edit listing' : 'New listing') : 'Listings';
    closeMobileSidebar();
  }

  function setPreferenceTab(tabName) {
    activePreferenceTab = tabName === 'smtp' ? 'smtp' : 'site';
    $$('[data-preference-tab]').forEach(tab => {
      const active = tab.dataset.preferenceTab === activePreferenceTab;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('[data-preference-panel]').forEach(panel => {
      panel.hidden = panel.dataset.preferencePanel !== activePreferenceTab;
    });
    const saveButton = $('#preferences-save-button');
    if (saveButton) {
      const label = activePreferenceTab === 'smtp' ? 'Save SMTP settings' : 'Save preferences';
      saveButton.innerHTML = label + ' <span aria-hidden="true">↗</span>';
    }
  }

  function makeStatusPill(status) {
    const pill = document.createElement('span');
    pill.className = 'status-pill' + (status === 'Reserved' ? ' reserved' : status === 'Unavailable' ? ' unavailable' : '');
    pill.textContent = status || 'Looking for a home';
    return pill;
  }

  function renderListings() {
    listingList.replaceChildren();
    const count = listings.length;
    listingCount.textContent = count + (count === 1 ? ' listing' : ' listings');
    if (!count) {
      const empty = document.createElement('div');
      empty.className = 'empty-listings';
      if (listingsLoading) {
        empty.innerHTML = '<div class="empty-icon" aria-hidden="true">✿</div><h2>Loading listings…</h2><p>Loading your puppy listings.</p>';
        listingList.appendChild(empty);
        return;
      }
      if (listingsError) {
        empty.innerHTML = '<div class="empty-icon" aria-hidden="true">!</div><h2>Could not load listings</h2><p></p>';
        empty.querySelector('p').textContent = listingsError;
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'primary-button'; retry.textContent = 'Retry connection';
        retry.addEventListener('click', () => refreshListings());
        empty.appendChild(retry);
        listingList.appendChild(empty);
        return;
      }
      empty.innerHTML = '<div class="empty-icon" aria-hidden="true">✿</div><h2>No puppy listings yet</h2><p>Add your first puppy to start building your little family page. Your listings will appear on the public website.</p>';
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'primary-button'; button.textContent = '＋ Add listing';
      button.addEventListener('click', () => openListingEditor());
      empty.appendChild(button); listingList.appendChild(empty); return;
    }

    listings.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
      const row = document.createElement('article');
      row.className = 'listing-row';
      const thumbWrap = document.createElement('div'); thumbWrap.className = 'listing-thumb';
      const img = document.createElement('img');
      const imageSource = safeImageURL(item.image);
      if (imageSource) img.src = imageSource;
      img.alt = item.imageAlt || (item.name + ' puppy');
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        img.removeAttribute('src');
        img.alt = 'Puppy image unavailable';
        thumbWrap.classList.add('image-unavailable');
      }, { once: true });
      thumbWrap.appendChild(img);
      const info = document.createElement('div'); info.className = 'listing-info';
      const titleLine = document.createElement('div'); titleLine.className = 'listing-name-row';
      const title = document.createElement('h2'); title.textContent = item.name;
      titleLine.append(title, makeStatusPill(item.status));
      const details = document.createElement('div'); details.className = 'listing-details';
      const price = document.createElement('strong'); price.className = 'listing-price'; price.textContent = money(item.price);
      details.append(price);
      info.append(titleLine, details);
      const actions = document.createElement('div'); actions.className = 'listing-actions';
      const view = document.createElement('a'); view.className = 'small-action'; view.href = '/' + item.slug; view.textContent = 'View';
      const edit = document.createElement('button'); edit.className = 'small-action'; edit.type = 'button'; edit.textContent = 'Edit'; edit.addEventListener('click', () => openListingEditor(item));
      const del = document.createElement('button'); del.className = 'small-action delete'; del.type = 'button'; del.textContent = 'Delete'; del.addEventListener('click', () => requestDelete(item.slug));
      actions.append(view, edit, del); row.append(thumbWrap, info, actions); listingList.appendChild(row);
    });
  }

  const MAX_GALLERY_IMAGES = 8;
  const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
  const TARGET_IMAGE_BYTES = 240 * 1024;
  const DOCUMENT_LIMIT_BYTES = 1024 * 1024;
  const DOCUMENT_MAX_SAFE_BYTES = DOCUMENT_LIMIT_BYTES - 4;
  const documentSizeEncoder = new TextEncoder();

  function storedStringSize(value) {
    return documentSizeEncoder.encode(String(value)).byteLength + 1;
  }

  function storedValueSize(value) {
    if (value === null || value === undefined) return 1;
    if (typeof value === 'string') return storedStringSize(value);
    if (typeof value === 'boolean') return 1;
    if (typeof value === 'number') return 8;
    if (Array.isArray(value)) return value.reduce((sum, entry) => sum + storedValueSize(entry), 0);
    if (typeof value === 'object') {
      return 32 + Object.entries(value).reduce((sum, [key, nested]) => sum + storedStringSize(key) + storedValueSize(nested), 0);
    }
    return 1;
  }

  function estimateDocumentSizeBytes(fields, documentPath) {
    const nameBytes = 16 + String(documentPath || '').split('/').filter(Boolean).reduce((sum, part) => sum + storedStringSize(part), 0);
    const fieldBytes = Object.entries(fields || {}).reduce((sum, [key, value]) => sum + storedStringSize(key) + storedValueSize(value), 0);
    return nameBytes + fieldBytes + 32;
  }
  let currentCoverImage = '';
  let currentCoverName = '';
  let currentCoverSize = 0;
  let currentGalleryImages = [];
  let coverUploadToken = 0;
  let galleryUploading = false;

  function formatFileSize(bytes) {
    if (!bytes) return 'Current image';
    return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function imageListSource(entry) {
    if (typeof entry === 'string') return entry;
    return entry && typeof entry.src === 'string' ? entry.src : '';
  }

  function renderCoverPreview() {
    const wrapper = $('#cover-image-preview');
    const dropzone = $('#cover-dropzone');
    const image = $('#cover-preview-image');
    const name = $('#cover-preview-name');
    const meta = $('#cover-preview-meta');
    const prompt = dropzone && $('.upload-copy strong', dropzone);
    if (!wrapper || !image || !dropzone) return;
    wrapper.hidden = !currentCoverImage;
    dropzone.classList.toggle('has-image', Boolean(currentCoverImage));
    if (prompt) prompt.textContent = currentCoverImage ? 'Cover photo ready' : 'Drop your cover photo here';
    if (!currentCoverImage) {
      image.removeAttribute('src');
      return;
    }
    image.src = currentCoverImage;
    image.alt = currentCoverName || 'Cover image preview';
    name.textContent = currentCoverName || 'Current cover photo';
    meta.textContent = formatFileSize(currentCoverSize) + (currentCoverSize ? ' · optimized' : '');
  }

  function renderGalleryPreviews() {
    const grid = $('#gallery-image-grid');
    const heading = $('#gallery-upload-heading');
    const counter = $('#gallery-photo-count');
    if (!grid) return;
    grid.replaceChildren();
    if (heading) heading.hidden = currentGalleryImages.length === 0;
    if (counter) counter.textContent = currentGalleryImages.length + ' of ' + MAX_GALLERY_IMAGES;

    currentGalleryImages.forEach((photo, index) => {
      const tile = document.createElement('article');
      tile.className = 'gallery-upload-tile';
      const image = document.createElement('img');
      image.src = photo.src;
      image.alt = photo.name || ('Gallery photo ' + (index + 1));
      image.loading = 'lazy';
      const caption = document.createElement('span');
      caption.className = 'gallery-upload-caption';
      caption.textContent = photo.name || ('Photo ' + (index + 1));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-upload-button gallery-remove-button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove gallery photo ' + (index + 1));
      remove.addEventListener('click', () => {
        currentGalleryImages.splice(index, 1);
        renderGalleryPreviews();
      });
      tile.append(image, caption, remove);
      grid.appendChild(tile);
    });
  }

  function showUploadError(message) {
    listingFormError.textContent = message;
    listingFormError.hidden = false;
  }

  function decodeImageFile(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve({ image, objectUrl });
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('This image could not be opened. Try another photo.'));
      };
      image.src = objectUrl;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to optimize this image.')), 'image/jpeg', quality);
    });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to prepare this image.'));
      reader.readAsDataURL(blob);
    });
  }

  async function optimizeImageFile(file) {
    if (!file || !/^image\/(?:jpeg|png|webp|gif|avif)$/i.test(file.type)) {
      throw new Error('Choose a JPG, PNG, WebP, GIF, or AVIF image.');
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('Each image must be smaller than 15 MB.');
    const decoded = await decodeImageFile(file);
    try {
      const originalWidth = decoded.image.naturalWidth || decoded.image.width;
      const originalHeight = decoded.image.naturalHeight || decoded.image.height;
      if (!originalWidth || !originalHeight) throw new Error('This image has no readable dimensions.');
      let maxDimension = Math.min(1400, Math.max(originalWidth, originalHeight));
      let quality = 0.82;
      let blob = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(originalWidth * scale));
        canvas.height = Math.max(1, Math.round(originalHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Image processing is unavailable in this browser.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
        blob = await canvasToBlob(canvas, quality);
        if (blob.size <= TARGET_IMAGE_BYTES) break;
        if (quality > 0.42) {
          quality = Math.max(0.42, quality - 0.08);
        } else {
          const nextDimension = Math.max(240, Math.floor(maxDimension * 0.78));
          if (nextDimension === maxDimension && maxDimension <= 240) break;
          maxDimension = nextDimension;
          quality = 0.68;
        }
      }
      if (!blob) throw new Error('Unable to optimize this image.');
      if (blob.size > TARGET_IMAGE_BYTES) throw new Error('Could not compress this image to 240 KB or less. Try a different photo.');
      return { src: await blobToDataURL(blob), name: file.name, size: blob.size };
    } finally {
      URL.revokeObjectURL(decoded.objectUrl);
    }
  }

  function setUploadBusy(zone, button, busy, idleText) {
    if (zone) zone.classList.toggle('is-uploading', Boolean(busy));
    if (button) {
      button.disabled = Boolean(busy);
      button.textContent = busy ? 'Optimizing…' : idleText;
    }
  }

  async function handleCoverFiles(fileList) {
    const file = Array.from(fileList || [])[0];
    if (!file) return;
    const token = ++coverUploadToken;
    const zone = $('#cover-dropzone');
    const button = $('#cover-browse-button');
    listingFormError.hidden = true;
    setUploadBusy(zone, button, true, 'Choose photo');
    try {
      const optimized = await optimizeImageFile(file);
      if (token !== coverUploadToken) return;
      currentCoverImage = optimized.src;
      currentCoverName = optimized.name;
      currentCoverSize = optimized.size;
      renderCoverPreview();
      showToast('Cover photo ready.');
    } catch (error) {
      if (token === coverUploadToken) showUploadError(error.message || 'Unable to upload this cover photo.');
    } finally {
      if (token === coverUploadToken) setUploadBusy(zone, button, false, 'Choose photo');
      $('#listing-image-file').value = '';
    }
  }

  async function handleGalleryFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || galleryUploading) return;
    listingFormError.hidden = true;
    const remaining = MAX_GALLERY_IMAGES - currentGalleryImages.length;
    if (remaining <= 0) {
      showUploadError('You can add up to ' + MAX_GALLERY_IMAGES + ' gallery photos. Remove a photo before adding another.');
      $('#listing-gallery-files').value = '';
      return;
    }
    if (files.length > remaining) showUploadError('Only ' + remaining + ' more gallery photo' + (remaining === 1 ? '' : 's') + ' can be added.');
    const acceptedFiles = files.slice(0, remaining);
    const zone = $('#gallery-dropzone');
    const button = $('#gallery-browse-button');
    galleryUploading = true;
    setUploadBusy(zone, button, true, 'Add photos');
    for (const file of acceptedFiles) {
      try {
        const optimized = await optimizeImageFile(file);
        currentGalleryImages.push(optimized);
        renderGalleryPreviews();
      } catch (error) {
        showUploadError((file.name || 'This file') + ': ' + (error.message || 'Unable to process this image.'));
      }
    }
    galleryUploading = false;
    setUploadBusy(zone, button, false, 'Add photos');
    $('#listing-gallery-files').value = '';
    if (currentGalleryImages.length) showToast('Gallery photos updated.');
  }

  function bindImageDropzone(zoneId, inputId, buttonId, handler) {
    const zone = $('#' + zoneId);
    const input = $('#' + inputId);
    const button = $('#' + buttonId);
    if (!zone || !input || !button) return;
    button.addEventListener('click', event => { event.stopPropagation(); input.click(); });
    zone.addEventListener('click', event => {
      if (!event.target.closest('button')) input.click();
    });
    zone.addEventListener('dragover', event => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    });
    zone.addEventListener('dragenter', event => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    });
    zone.addEventListener('dragleave', event => {
      if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-dragging');
    });
    zone.addEventListener('drop', event => {
      event.preventDefault();
      zone.classList.remove('is-dragging');
      handler(event.dataTransfer && event.dataTransfer.files);
    });
    input.addEventListener('change', () => handler(input.files));
  }

  function uniqueSlugForName(name, originalSlug) {
    const base = slugify(name) || 'puppy';
    let candidate = base;
    let counter = 2;
    while (listings.some(item => item.slug === candidate && item.slug !== originalSlug)) {
      candidate = base + '-' + counter;
      counter += 1;
    }
    return candidate;
  }

  const formFields = ['name', 'gender', 'age', 'price', 'status', 'details'];
  async function openListingEditor(item, detailsLoaded = false) {
    if (item && !detailsLoaded) {
      showToast('Loading puppy details…');
      try {
        const fullListing = await fetchPuppyDetails(item.slug);
        await openListingEditor(fullListing, true);
      } catch (error) {
        showToast(error.message || 'Unable to load this puppy.');
      }
      return;
    }
    listingForm.reset(); listingFormError.hidden = true;
    $('#listing-original-slug').value = item ? item.slug : '';
    $('#listing-editor-title').innerHTML = item ? 'Edit a <em>listing.</em>' : 'Add a <em>listing.</em>';
    $('#listing-editor-kicker').textContent = item ? 'EDIT PUPPY PROFILE' : 'NEW PUPPY PROFILE';
    $('#listing-editor-description').textContent = item ? 'Update this puppy’s details and photos.' : 'Add the details and photos for a puppy.';
    $('#save-listing-button').innerHTML = item ? 'Save changes <span aria-hidden="true">↗</span>' : 'Save listing <span aria-hidden="true">↗</span>';
    $('#listing-image-file').value = '';
    $('#listing-gallery-files').value = '';
    currentCoverImage = item ? safeImageURL(item.image) : '';
    currentCoverName = currentCoverImage ? 'Current cover photo' : '';
    currentCoverSize = 0;
    const coverSrc = currentCoverImage;
    currentGalleryImages = item && Array.isArray(item.gallery) ? item.gallery.map((entry, index) => {
      const src = safeImageURL(imageListSource(entry));
      return src ? { src, name: entry && typeof entry === 'object' && entry.name ? entry.name : 'Gallery photo ' + (index + 1), size: 0 } : null;
    }).filter(photo => photo && photo.src !== coverSrc).slice(0, MAX_GALLERY_IMAGES) : [];
    if (item) {
      formFields.forEach(name => {
        const field = $('#listing-' + name);
        if (!field) return;
        if (name === 'price') field.value = Number(item.price) || '';
        else field.value = item[name] || '';
      });
    } else {
      $('#listing-gender').value = 'Male';
      $('#listing-status').value = 'Looking for a home';
      $('#listing-name').value = '';
      $('#listing-price').value = '';
      $('#listing-details').value = '';
    }
    renderCoverPreview();
    renderGalleryPreviews();
    showView('editor');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => $('#listing-name').focus({ preventScroll: true }), 40);
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close(); else dialog.removeAttribute('open');
    if (!confirmDialog.open) document.body.classList.remove('dialog-open');
  }

  function parseImageList(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  async function handleListingSubmit(event) {
    event.preventDefault();
    listingFormError.hidden = true;
    const name = $('#listing-name').value.trim();
    const originalSlug = $('#listing-original-slug').value;
    const slug = originalSlug || uniqueSlugForName(name, originalSlug);
    const image = safeImageURL(currentCoverImage);
    const price = Number($('#listing-price').value);
    const details = $('#listing-details').value.trim();
    const existingItem = listings.find(item => item.slug === originalSlug);
    let problem = '';
    if (galleryUploading || $('#cover-dropzone').classList.contains('is-uploading')) problem = 'Please wait for image uploads to finish.';
    else if (name.length < 2) problem = 'Please enter a puppy name.';
    else if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) problem = 'Please use a name that can form a simple URL.';
    else if (listings.some(item => item.slug === slug && item.slug !== originalSlug)) problem = 'That puppy name is already in use. Choose a different name.';
    else if (!image) problem = 'Please upload a cover photo.';
    else if (!$('#listing-age').value.trim()) problem = 'Please enter the puppy age.';
    else if (!Number.isFinite(price) || price < 0) problem = 'Please enter a valid price in CAD.';
    if (problem) { listingFormError.textContent = problem; listingFormError.hidden = false; return; }

    const summary = details || (existingItem && existingItem.summary) || (name + ' is a lovely Papillon puppy ready to meet a caring family.');
    const gallery = currentGalleryImages.map(photo => photo.src).filter(Boolean);
    const item = {
      slug, name, gender: $('#listing-gender').value, age: $('#listing-age').value.trim(), price,
      status: $('#listing-status').value,
      // These optional legacy properties are preserved when editing older listings,
      // but are no longer editable fields in the form.
      coat: existingItem ? (existingItem.coat || '') : '',
      personality: existingItem ? (existingItem.personality || '') : '',
      image, imageAlt: name + ' Papillon puppy', summary,
      details: details || (existingItem && existingItem.details) || summary,
      gallery
    };

    // Check the complete saved document size before submitting. The server
    // independently repeats this check before any write is committed.
    const sizeCheckNow = new Date().toISOString();
    const estimatedMainDocument = {
      slug: item.slug,
      name: item.name.slice(0, 80),
      gender: String(item.gender || '').slice(0, 24),
      coat: String(item.coat || '').slice(0, 60),
      age: item.age.slice(0, 80),
      price: item.price,
      status: String(item.status || 'Looking for a home').slice(0, 80),
      personality: String(item.personality || '').slice(0, 120),
      image: item.image,
      imageAlt: item.imageAlt.slice(0, 160),
      imageSizeBytes: currentCoverSize || 0,
      summary: String(item.summary || '').slice(0, 500),
      details: String(item.details || item.summary || '').slice(0, 5000),
      galleryCount: gallery.length,
      createdAt: existingItem && existingItem.createdAt ? existingItem.createdAt : sizeCheckNow,
      updatedAt: sizeCheckNow
    };
    const estimatedMainBytes = estimateDocumentSizeBytes(estimatedMainDocument, 'puppies/' + slug);
    const oversizedGalleryIndex = gallery.findIndex((src, index) => estimateDocumentSizeBytes({
      image: src,
      name: 'Gallery photo ' + (index + 1),
      alt: name + ' puppy photo ' + (index + 1),
      sizeBytes: 0,
      sortOrder: index + 1
    }, 'puppies/' + slug + '/gallery/photo-' + String(index + 1).padStart(2, '0')) > DOCUMENT_MAX_SAFE_BYTES);
    if (estimatedMainBytes > DOCUMENT_MAX_SAFE_BYTES || oversizedGalleryIndex >= 0) {
      listingFormError.textContent = 'This listing is too large to save. Please choose a smaller photo or shorten the listing text.';
      listingFormError.hidden = false;
      return;
    }

    const existingIndex = listings.findIndex(entry => entry.slug === originalSlug);
    const saveButton = $('#save-listing-button');
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
    try {
      await savePuppyListing(item);
      await refreshListings();
      showView('listings');
      showToast(existingIndex >= 0 ? 'Listing updated.' : 'Listing created.');
    } catch (error) {
      listingFormError.textContent = error.message || 'Unable to save the listing. Please try again.';
      listingFormError.hidden = false;
    } finally {
      if (saveButton) saveButton.disabled = false;
      setPreferenceTab(activePreferenceTab);
    }
  }

  function requestDelete(slug) {
    const item = listings.find(entry => entry.slug === slug);
    if (!item) return;
    openConfirmation({ title: 'Delete this listing?', message: 'This will permanently remove ' + item.name + ' and its gallery images.', acceptText: 'Delete listing', dangerous: true, action: async () => {
      try {
        const response = await apiFetch('/api/puppies?slug=' + encodeURIComponent(slug), {
          method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || 'Unable to delete this puppy.');
        await refreshListings();
        showToast('Listing deleted.');
      } catch (error) {
        showToast(error.message || 'Unable to delete listing.');
      }
    } });
  }

  function openConfirmation(settings) {
    pendingConfirmation = settings.action;
    $('#confirm-title').textContent = settings.title;
    $('#confirm-message').textContent = settings.message;
    $('#confirm-accept').textContent = settings.acceptText || 'Confirm';
    $('#confirm-accept').classList.toggle('danger-button', Boolean(settings.dangerous));
    if (typeof confirmDialog.showModal === 'function') confirmDialog.showModal(); else confirmDialog.setAttribute('open', '');
    document.body.classList.add('dialog-open');
  }

  const LOCK_ICON = '<svg viewBox="0 0 24 24" focusable="false"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>';
  const UNLOCK_ICON = '<svg viewBox="0 0 24 24" focusable="false"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 7.5-2"></path></svg>';

  function setPreferenceFieldLocked(button, locked) {
    const field = document.getElementById(button.dataset.lockTarget);
    if (!field) return;
    field.disabled = locked;
    if (field.id === 'preference-site-og-image-file') {
      const removeImageButton = $('#preference-site-og-image-remove');
      if (removeImageButton) removeImageButton.disabled = locked || !currentSiteOgImage;
    }
    const wrap = button.closest('.locked-field');
    if (wrap) wrap.classList.toggle('is-unlocked', !locked);
    button.classList.toggle('is-unlocked', !locked);
    button.setAttribute('aria-pressed', String(!locked));
    const icon = button.querySelector('.lock-toggle-icon');
    const fieldLabel = field.labels && field.labels[0] ? field.labels[0].textContent.trim() : field.name;
    if (icon) icon.innerHTML = locked ? LOCK_ICON : UNLOCK_ICON;
    button.setAttribute('aria-label', (locked ? 'Unlock ' : 'Lock ') + fieldLabel.toLowerCase());
  }

  function lockAllPreferenceFields() {
    $$('.field-lock-toggle[data-lock-target]').forEach(button => setPreferenceFieldLocked(button, true));
  }

  let savedSmtpPasswordExists = false;

  async function loadPreferencesIntoForm() {
    const feedback = $('#preferences-feedback');
    const legacy = readJSON(PREFERENCES_KEY, {}) || {};
    let preferences = legacy;
    let cameFromServer = false;
    feedback.textContent = '';
    feedback.classList.remove('error');

    try {
      const response = await apiFetch('/api/preferences', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.preferences) {
        cameFromServer = Boolean(result.configured);
        // Public website settings are loaded separately from private contact and SMTP settings.
        preferences = cameFromServer
          ? result.preferences
          : {
              ...legacy,
              script: result.preferences.script || legacy.script || '',
              phoneNumber: result.preferences.phoneNumber || legacy.phoneNumber || '',
              siteTitle: result.preferences.siteTitle || legacy.siteTitle || '',
              siteBranding: result.preferences.siteBranding || legacy.siteBranding || '',
              siteDescription: result.preferences.siteDescription || legacy.siteDescription || '',
              siteOgImage: result.preferences.siteOgImage || ''
            };
        savedSmtpPasswordExists = cameFromServer && Boolean(result.preferences.smtp && result.preferences.smtp.hasPassword);
      } else if (response.status === 401) {
        feedback.textContent = 'Your Firebase sign-in could not be verified. Sign in again to manage preferences.';
        feedback.classList.add('error');
      } else {
        feedback.textContent = result.error || 'Server preferences are not available yet. Check the Firebase service-account configuration, then save these settings.';
        feedback.classList.add('error');
      }
    } catch (_) {
      feedback.textContent = 'Could not reach the preferences service. Check that the site is deployed with its Pages Functions.';
      feedback.classList.add('error');
    }

    const smtp = preferences.smtp || {};
    if (cameFromServer) {
      // Clear any legacy plaintext SMTP password that may have been saved by an earlier version.
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
        email: preferences.email || '',
        script: preferences.script || '',
        phoneNumber: preferences.phoneNumber || '',
        siteTitle: preferences.siteTitle || '',
        siteBranding: preferences.siteBranding || '',
        siteDescription: preferences.siteDescription || '',
        siteOgImage: preferences.siteOgImage || '',
        smtp: {
          host: smtp.host || '',
          port: smtp.port || '',
          security: Number(smtp.port) === 465 ? 'ssl' : 'starttls',
          username: smtp.username || '',
          hasPassword: Boolean(smtp.hasPassword)
        }
      }));
    }
    $('#preference-email').value = preferences.email || '';
    $('#preference-script').value = preferences.script || '';
    $('#preference-phone-number').value = preferences.phoneNumber || '';
    $('#preference-site-title').value = preferences.siteTitle || 'Papillon & Co. — Little dogs, big love';
    $('#preference-site-branding').value = preferences.siteBranding || 'Papillon & Co.';
    $('#preference-site-description').value = preferences.siteDescription || 'Meet our charming Papillon puppies, raised with care and ready to find their forever homes.';
    currentSiteOgImage = typeof preferences.siteOgImage === 'string' && preferences.siteOgImage.startsWith('data:image/jpeg;base64,') ? preferences.siteOgImage : '';
    renderSiteOgImagePreview(currentSiteOgImage, currentSiteOgImage ? 'Saved social preview image' : '');
    $('#preference-site-og-image-file').value = '';
    $('#preference-smtp-host').value = smtp.host || '';
    $('#preference-smtp-port').value = smtp.port || '';
    $('#preference-smtp-username').value = smtp.username || '';
    // The server intentionally never sends the SMTP password back to the browser.
    $('#preference-smtp-password').value = cameFromServer ? '' : (smtp.password || '');
    $('#preference-smtp-password').placeholder = savedSmtpPasswordExists ? 'Saved securely — leave blank to keep it' : 'Enter SMTP password';
    if (!cameFromServer && legacy.smtp && legacy.smtp.password) {
      feedback.textContent = 'These look like older browser-only settings. Save preferences to migrate them into secure server storage.';
      feedback.classList.remove('error');
    }
    lockAllPreferenceFields();
  }

  function renderSiteOgImagePreview(dataUrl, title) {
    const wrap = $('#preference-site-og-image-preview');
    const image = $('#preference-site-og-image-preview-image');
    const titleElement = $('#preference-site-og-image-preview-title');
    const sizeElement = $('#preference-site-og-image-preview-size');
    const removeButton = $('#preference-site-og-image-remove');
    if (!wrap || !image || !titleElement || !sizeElement) return;
    if (!dataUrl) {
      wrap.hidden = true;
      image.removeAttribute('src');
      if (titleElement) titleElement.textContent = 'No custom social preview image';
      if (sizeElement) sizeElement.textContent = 'The built-in Papillon preview image will be used.';
      if (removeButton) removeButton.disabled = true;
      return;
    }
    image.src = dataUrl;
    wrap.hidden = false;
    titleElement.textContent = title || 'Social preview image';
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (match) {
      const encoded = match[1];
      const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
      const size = Math.floor((encoded.length * 3) / 4) - padding;
      sizeElement.textContent = 'Optimized JPEG · ' + (size / 1024).toFixed(1) + ' KB · maximum 240 KB';
    } else {
      sizeElement.textContent = 'JPEG · maximum 240 KB after compression';
    }
    if (removeButton) removeButton.disabled = $('#preference-site-og-image-file')?.disabled || false;
  }

  async function handleSiteOgImageSelection(event) {
    const file = Array.from(event.target.files || [])[0];
    if (!file) return;
    const feedback = $('#preferences-feedback');
    feedback.classList.remove('error');
    feedback.textContent = 'Optimizing social preview image…';
    try {
      const optimized = await optimizeImageFile(file);
      currentSiteOgImage = optimized.src;
      renderSiteOgImagePreview(optimized.src, optimized.name);
      const removeButton = $('#preference-site-og-image-remove');
      if (removeButton) removeButton.disabled = false;
      feedback.textContent = 'Social preview image optimized to ' + (optimized.size / 1024).toFixed(1) + ' KB. Save preferences to publish it.';
    } catch (error) {
      feedback.textContent = error.message || 'Could not optimize this social preview image.';
      feedback.classList.add('error');
    } finally {
      event.target.value = '';
    }
  }

  function removeSiteOgImage() {
    currentSiteOgImage = '';
    siteOgImageDirty = true;
    renderSiteOgImagePreview('', '');
    const removeButton = $('#preference-site-og-image-remove');
    if (removeButton) removeButton.disabled = Boolean($('#preference-site-og-image-file')?.disabled) || !currentSiteOgImage;
    const feedback = $('#preferences-feedback');
    if (feedback) {
      feedback.classList.remove('error');
      feedback.textContent = 'Custom social preview image removed locally. Save preferences to publish the change.';
    }
  }

  async function handlePreferencesSave(event) {
    event.preventDefault();
    const email = $('#preference-email').value.trim();
    const script = $('#preference-script').value;
    const phoneNumber = $('#preference-phone-number').value.trim();
    const siteTitle = $('#preference-site-title').value.trim();
    const siteBranding = $('#preference-site-branding').value.trim();
    const siteDescription = $('#preference-site-description').value.trim();
    const feedback = $('#preferences-feedback');
    const smtpHost = $('#preference-smtp-host').value.trim();
    const smtpPortRaw = $('#preference-smtp-port').value.trim();
    const smtpUsername = $('#preference-smtp-username').value.trim();
    const smtpPassword = $('#preference-smtp-password').value;
    const hasAnySmtpValue = Boolean(smtpHost || smtpPortRaw || smtpUsername || smtpPassword);
    feedback.classList.remove('error');

    if (siteTitle.length > 120 || siteBranding.length > 80 || siteDescription.length > 400) {
      feedback.textContent = 'Site title, brand name, or site description exceeds its maximum length.'; feedback.classList.add('error'); return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      feedback.textContent = 'Please enter a valid contact email address or leave it blank.'; feedback.classList.add('error'); return;
    }
    const phoneDigits = phoneNumber.replace(/\D/g, '');
    if (phoneNumber && (!/^\+?[0-9().\-\s]{7,32}$/.test(phoneNumber) || phoneDigits.length < 7 || phoneDigits.length > 20)) {
      feedback.textContent = 'Enter a valid phone number with 7–20 digits, or leave it blank.'; feedback.classList.add('error'); return;
    }
    const smtpPort = smtpPortRaw ? Number(smtpPortRaw) : '';
    if (smtpPortRaw && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535 || smtpPort === 25)) {
      feedback.textContent = 'Enter a valid SMTP submission port. Ports 465 and 587 are commonly supported; port 25 is unavailable.'; feedback.classList.add('error'); return;
    }
    if (hasAnySmtpValue && (!smtpHost || !smtpPort || !smtpUsername)) {
      feedback.textContent = 'Complete the SMTP host, port, and username or clear all SMTP fields.'; feedback.classList.add('error'); return;
    }

    const saveButton = $('#preferences-form button[type="submit"]');
    const originalButtonText = saveButton ? saveButton.innerHTML : '';
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
    feedback.textContent = '';
    try {
      const response = await apiFetch('/api/preferences', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          email,
          script,
          phoneNumber,
          siteTitle,
          siteBranding,
          siteDescription,
          siteOgImage: currentSiteOgImage,
          smtp: { host: smtpHost, port: smtpPort, username: smtpUsername, password: smtpPassword }
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || 'Preferences could not be saved.');

      const safePreferences = {
        email,
        script,
        phoneNumber,
        siteTitle,
        siteBranding,
        siteDescription,
        siteOgImage: currentSiteOgImage,
        smtp: { host: smtpHost, port: smtpPort, security: smtpPort === 465 ? 'ssl' : 'starttls', username: smtpUsername, hasPassword: Boolean(hasAnySmtpValue) }
      };
      // Keep only non-secret convenience values in local storage; credentials live server-side.
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(safePreferences));
      savedSmtpPasswordExists = hasAnySmtpValue;
        $('#preference-smtp-password').value = '';
      $('#preference-smtp-password').placeholder = savedSmtpPasswordExists ? 'Saved securely — leave blank to keep it' : 'Enter SMTP password';
      lockAllPreferenceFields();
      feedback.textContent = result.message || 'Preferences saved securely.';
      showToast('Preferences saved.');
    } catch (error) {
      feedback.textContent = error.message || 'Preferences could not be saved. Please try again.';
      feedback.classList.add('error');
    } finally {
      if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = originalButtonText; }
    }
  }

  if (passwordToggle && passwordInput) passwordToggle.addEventListener('click', function () {
    const reveal = passwordInput.type === 'password';
    passwordInput.type = reveal ? 'text' : 'password';
    passwordToggle.textContent = reveal ? 'Hide' : 'Show';
    passwordToggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    passwordToggle.setAttribute('aria-pressed', String(reveal));
    passwordInput.focus();
  });

  if (loginForm) loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (loginSubmit && loginSubmit.disabled) return;
    loginError.hidden = true;
    const email = $('#login-email').value.trim();
    const password = passwordInput.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      loginError.textContent = 'Enter a valid email address and password.';
      loginError.hidden = false;
      return;
    }
    if (!auth || !signInWithEmailAndPassword) {
      loginError.textContent = 'Firebase Authentication is not ready. Check the six Firebase Web config variables in Cloudflare and reload.';
      loginError.hidden = false;
      return;
    }
    isSubmittingLogin = true;
    setLoginLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await credential.user.getIdToken(true);
      const response = await apiFetch('/api/admin-session', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.authenticated) {
        await signOut(auth).catch(() => {});
        throw new Error(result.error || 'Your Firebase sign-in could not be verified. Sign in again.');
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true, email: result.email || credential.user.email }));
      passwordInput.value = '';
      currentEmail = result.email || credential.user.email || '';
      await showApp();
      showToast('Signed in with Firebase.');
    } catch (error) {
      const code = String(error?.code || '');
      const firebaseMessages = {
        'auth/invalid-credential': 'The email or password is incorrect.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Authentication settings.',
        'auth/unauthorized-domain': 'Add this website domain to Firebase Authentication authorized domains.',
        'auth/invalid-api-key': 'The Firebase API key is missing or invalid. Check the Cloudflare FIREBASE_API_KEY variable.',
        'auth/user-disabled': 'This Firebase account has been disabled.',
        'auth/too-many-requests': 'Too many sign-in attempts. Wait a little and try again.',
        'auth/network-request-failed': 'Firebase could not be reached. Check your internet connection.'
      };
      loginError.textContent = firebaseMessages[code] || error.message || 'Sign-in failed. Please try again.';
      loginError.hidden = false;
    } finally {
      isSubmittingLogin = false;
      setLoginLoading(false);
    }
  });

  $$('[data-preference-tab]').forEach(tab => {
    tab.addEventListener('click', () => setPreferenceTab(tab.dataset.preferenceTab));
    tab.addEventListener('keydown', event => {
      const order = ['site', 'smtp'];
      const current = order.indexOf(tab.dataset.preferenceTab);
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % order.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = order.length - 1;
      else return;
      event.preventDefault();
      setPreferenceTab(order[next]);
      const target = $('[data-preference-tab="' + order[next] + '"]');
      if (target) target.focus();
    });
  });
  setPreferenceTab('site');

  $$('.sidebar-nav-link[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  if (menuToggle) menuToggle.addEventListener('click', function () {
    const open = !app.classList.contains('sidebar-open');
    app.classList.toggle('sidebar-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close dashboard menu' : 'Open dashboard menu');
    if (open) document.body.classList.remove('dialog-open');
  });
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeMobileSidebar);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileSidebar(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 760) closeMobileSidebar(); });
  $('#add-listing-button').addEventListener('click', () => openListingEditor());
  listingForm.addEventListener('submit', handleListingSubmit);
  $('#preferences-form').addEventListener('submit', handlePreferencesSave);
  $('#preference-site-og-image-file').addEventListener('change', handleSiteOgImageSelection);
  $('#preference-site-og-image-remove').addEventListener('click', removeSiteOgImage);
  $$('.field-lock-toggle[data-lock-target]').forEach(button => button.addEventListener('click', () => {
    const field = document.getElementById(button.dataset.lockTarget);
    setPreferenceFieldLocked(button, !(field && field.disabled));
    if (field && !field.disabled) field.focus();
  }));
  $('#cancel-listing-button').addEventListener('click', () => { showView('listings'); renderListings(); });
  $('#cancel-listing-button-bottom').addEventListener('click', () => { showView('listings'); renderListings(); });
  [confirmDialog].forEach(dialog => {
    dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); });
    dialog.addEventListener('close', () => { if (!confirmDialog.open) document.body.classList.remove('dialog-open'); });
  });
  $('#confirm-cancel').addEventListener('click', () => closeDialog(confirmDialog));
  $('#confirm-accept').addEventListener('click', function () {
    const action = pendingConfirmation; pendingConfirmation = null; closeDialog(confirmDialog);
    if (action) action();
  });
  $('#logout-button').addEventListener('click', () => openConfirmation({
    title: 'Log out of the dashboard?', message: 'You will be signed out and returned to the sign-in screen.', acceptText: 'Log out', action: async () => {
      startAuthTransition('Signing you out…');
      if (auth && signOut) await signOut(auth).catch(() => {});
      localStorage.removeItem(SESSION_KEY);
      showLogin();
      showToast('You have logged out.');
    }
  }));
  $('#remove-cover-image').addEventListener('click', function () {
    coverUploadToken += 1;
    currentCoverImage = '';
    currentCoverName = '';
    currentCoverSize = 0;
    setUploadBusy($('#cover-dropzone'), $('#cover-browse-button'), false, 'Choose photo');
    renderCoverPreview();
  });
  bindImageDropzone('cover-dropzone', 'listing-image-file', 'cover-browse-button', handleCoverFiles);
  bindImageDropzone('gallery-dropzone', 'listing-gallery-files', 'gallery-browse-button', handleGalleryFiles);

  (async function initializeFirebaseDashboardAuth() {
    try {
      const firebase = await import('./firebase.js');
      auth = firebase.auth;
      signInWithEmailAndPassword = firebase.signInWithEmailAndPassword;
      onAuthStateChanged = firebase.onAuthStateChanged;
      signOut = firebase.signOut;
      onAuthStateChanged(auth, async user => {
        if (isSubmittingLogin) return;
        if (!user) {
          localStorage.removeItem(SESSION_KEY);
          showLogin();
          return;
        }
        try {
          const response = await apiFetch('/api/admin-session', { cache: 'no-store' });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.authenticated) {
            localStorage.removeItem(SESSION_KEY);
            await signOut(auth).catch(() => {});
            showLogin();
            if (loginError) {
              loginError.textContent = result.error || 'Your Firebase sign-in could not be verified. Sign in again.';
              loginError.hidden = false;
            }
            return;
          }
          currentEmail = result.email || user.email || user.uid || '';
          localStorage.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true, email: currentEmail }));
          await showApp();
        } catch (error) {
          localStorage.removeItem(SESSION_KEY);
          showLogin();
          if (loginError) {
            loginError.textContent = error.message || 'Firebase sign-in verification failed. Check the Cloudflare Pages Functions and Firebase configuration.';
            loginError.hidden = false;
          }
        }
      });
    } catch (error) {
      showLogin();
      if (loginError) {
        loginError.textContent = error.message || 'Firebase Authentication could not initialize. Check the six Firebase Web config variables in Cloudflare.';
        loginError.hidden = false;
      }
    }
  })();
})();
