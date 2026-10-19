#!/usr/bin/env node

/**
 * Mobile Performance Test Script
 * 
 * This script simulates mobile conditions and tests the infinite scroll performance
 * Run with: node scripts/test-mobile-performance.js
 */

const puppeteer = require('puppeteer');

async function testMobilePerformance() {
  console.log('🚀 Starting Mobile Performance Test...\n');

  const browser = await puppeteer.launch({
    headless: false, // Set to true for CI
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();

  // Simulate mobile device
  await page.emulate({
    name: 'iPhone 12',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      isLandscape: false
    }
  });

  // Throttle network to simulate 3G
  await page.emulateNetworkConditions({
    offline: false,
    downloadThroughput: 1.5 * 1024 * 1024 / 8, // 1.5 Mbps
    uploadThroughput: 750 * 1024 / 8, // 750 Kbps
    latency: 40 // 40ms
  });

  // Throttle CPU to simulate low-end device
  await page.emulateCPUThrottling(4);

  console.log('📱 Mobile device emulation configured');
  console.log('🌐 Network throttled to 3G speeds');
  console.log('🔧 CPU throttled to 4x slower\n');

  try {
    // Navigate to the homepage
    console.log('🏠 Navigating to homepage...');
    await page.goto('http://localhost:3000', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Wait for markets to load
    await page.waitForSelector('[data-testid="market-card"]', { timeout: 15000 });
    console.log('✅ Markets loaded successfully\n');

    // Test scroll performance
    console.log('📜 Testing scroll performance...');
    
    const scrollMetrics = await page.evaluate(async () => {
      return new Promise((resolve) => {
        let frameCount = 0;
        let startTime = performance.now();
        let lastFrameTime = startTime;
        const frameTimes = [];

        const measureFrame = () => {
          const currentTime = performance.now();
          const frameTime = currentTime - lastFrameTime;
          frameTimes.push(frameTime);
          lastFrameTime = currentTime;
          frameCount++;

          if (frameCount < 60) { // Measure 60 frames
            requestAnimationFrame(measureFrame);
          } else {
            const totalTime = currentTime - startTime;
            const avgFPS = Math.round((frameCount * 1000) / totalTime);
            const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
            const maxFrameTime = Math.max(...frameTimes);
            
            resolve({
              avgFPS,
              avgFrameTime: Math.round(avgFrameTime * 100) / 100,
              maxFrameTime: Math.round(maxFrameTime * 100) / 100,
              totalFrames: frameCount
            });
          }
        };

        // Start scrolling and measuring
        let scrollPosition = 0;
        const scrollInterval = setInterval(() => {
          scrollPosition += 50;
          window.scrollTo(0, scrollPosition);
          
          if (scrollPosition > 2000) { // Stop after scrolling 2000px
            clearInterval(scrollInterval);
          }
        }, 16); // ~60fps scroll

        requestAnimationFrame(measureFrame);
      });
    });

    console.log('📊 Scroll Performance Results:');
    console.log(`   Average FPS: ${scrollMetrics.avgFPS}`);
    console.log(`   Average Frame Time: ${scrollMetrics.avgFrameTime}ms`);
    console.log(`   Max Frame Time: ${scrollMetrics.maxFrameTime}ms`);
    console.log(`   Total Frames: ${scrollMetrics.totalFrames}\n`);

    // Test memory usage
    console.log('🧠 Testing memory usage...');
    const memoryMetrics = await page.evaluate(() => {
      if (performance.memory) {
        return {
          usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
          jsHeapSizeLimit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
      }
      return null;
    });

    if (memoryMetrics) {
      console.log('📊 Memory Usage Results:');
      console.log(`   Used Heap: ${memoryMetrics.usedJSHeapSize}MB`);
      console.log(`   Total Heap: ${memoryMetrics.totalJSHeapSize}MB`);
      console.log(`   Heap Limit: ${memoryMetrics.jsHeapSizeLimit}MB\n`);
    }

    // Test network requests
    console.log('🌐 Analyzing network requests...');
    const networkMetrics = await page.evaluate(() => {
      return performance.getEntriesByType('navigation').concat(
        performance.getEntriesByType('resource')
      ).length;
    });

    console.log(`📊 Network Requests: ${networkMetrics} total requests\n`);

    // Performance assessment
    console.log('🎯 Performance Assessment:');
    
    const assessments = [];
    
    if (scrollMetrics.avgFPS >= 55) {
      assessments.push('✅ Excellent scroll performance (55+ FPS)');
    } else if (scrollMetrics.avgFPS >= 30) {
      assessments.push('⚠️  Good scroll performance (30-54 FPS)');
    } else {
      assessments.push('❌ Poor scroll performance (<30 FPS)');
    }

    if (memoryMetrics && memoryMetrics.usedJSHeapSize <= 120) {
      assessments.push('✅ Excellent memory usage (<120MB)');
    } else if (memoryMetrics && memoryMetrics.usedJSHeapSize <= 200) {
      assessments.push('⚠️  Good memory usage (120-200MB)');
    } else {
      assessments.push('❌ High memory usage (>200MB)');
    }

    if (networkMetrics <= 10) {
      assessments.push('✅ Excellent network efficiency (<10 requests)');
    } else if (networkMetrics <= 25) {
      assessments.push('⚠️  Good network efficiency (10-25 requests)');
    } else {
      assessments.push('❌ High network usage (>25 requests)');
    }

    assessments.forEach(assessment => console.log(`   ${assessment}`));

    console.log('\n🎉 Mobile performance test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
if (require.main === module) {
  testMobilePerformance().catch(console.error);
}

module.exports = { testMobilePerformance };