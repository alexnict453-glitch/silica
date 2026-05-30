// Copyright 2020 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview The code in this file tracks the load time of the background
 * image in order to send that time to the main NTP frame for metrics logging.
 */

let loadTime: number;

function sendLoadTime(time: number) {
  window.parent.postMessage(
      {
        frameType: 'background-image',
        messageType: 'loaded',
        url: location.href,
        time: time,
      },
      'chrome://new-tab-page');
}

function onImageLoad() {
  document.body.toggleAttribute('shown', true);
  loadTime = Date.now();
  sendLoadTime(loadTime);
}

// Silica: returns true when the background URL points at a video file that we
// render as a looping, muted wallpaper instead of a static image.
function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogv|ogg|mov|m4v)(?:[?#].*)?$/i.test(url);
}

function main() {
  // The NTP requests the load time as soon as it has installed the message
  // listener. In case we have already sent the load time we re-send the load
  // time so that the NTP has a chance to actually catch it.
  window.addEventListener('message', ({data}) => {
    if (data === 'sendLoadTime' && loadTime) {
      sendLoadTime(loadTime);
    }
  });

  const img = document.body.querySelector('img')!;

  // Silica: when the configured background is a video, play it full-bleed as a
  // muted, looping wallpaper in place of the static image.
  const video = document.body.querySelector('video');
  if (video && isVideoUrl(img.src)) {
    const image = document.body.querySelector<HTMLElement>('#image');
    if (image) {
      image.style.display = 'none';
    }
    video.hidden = false;
    video.addEventListener('loadeddata', onImageLoad, {once: true});
    video.src = img.src;
    // Muted autoplay is permitted; ignore transient rejections.
    video.play().catch(() => {});
    return;
  }

  if (img.complete) {
    // Handle case where the image has already loaded.
    onImageLoad();
    return;
  }

  img.addEventListener('load', onImageLoad);
}

document.addEventListener('DOMContentLoaded', main);
