#!/bin/bash
# Production Deployment Quick Setup Script
# Run this on your production server after setting up persistent storage

set -e

echo "🚀 Newscast AI - Production Setup"
echo "=================================="
echo ""

# Check for required environment variables
if [ -z "$DB_PATH" ]; then
    echo "⚠️  Warning: DB_PATH not set. Using default local path."
    echo "   For production, set DB_PATH to a persistent volume path."
    echo "   Example: export DB_PATH=/mnt/data/newscast.db"
    echo ""
fi

if [ -z "$GEMINI_API_KEY" ] && [ -z "$NVIDIA_api" ] && [ -z "$GROQ_API_KEY" ]; then
    echo "❌ Error: No LLM API keys configured!"
    echo "   At least one of the following must be set:"
    echo "   - GEMINI_API_KEY"
    echo "   - NVIDIA_api"
    echo "   - GROQ_API_KEY"
    exit 1
fi

echo "✅ Environment variables configured"
echo ""

# Create data directories if using persistent volume
if [ ! -z "$DB_PATH" ]; then
    DB_DIR=$(dirname "$DB_PATH")
    if [ ! -d "$DB_DIR" ]; then
        echo "📁 Creating database directory: $DB_DIR"
        mkdir -p "$DB_DIR"
    fi
    
    # Create media directories in the same persistent volume
    MEDIA_DIR="$DB_DIR/media"
    mkdir -p "$MEDIA_DIR/audio"
    mkdir -p "$MEDIA_DIR/video"
    mkdir -p "$MEDIA_DIR/frames"
    echo "✅ Persistent storage directories created"
    echo ""
fi

# Build the application
echo "🔨 Building application..."
npm run build
echo "✅ Build complete"
echo ""

# Start the application (or just verify it's ready)
echo "✅ Ready to start!"
echo ""
echo "To start the application:"
echo "  npm run start"
echo ""
echo "After starting, run your first news cycle:"
echo "  curl -X POST http://localhost:${PORT:-3150}/api/ingest"
echo ""
echo "Or visit your production URL and click 'Run news cycle'"
echo ""
echo "📊 Monitor at: http://localhost:${PORT:-3150}"
echo "📡 Access remotely: https://newscast.t0r.tech (if configured)"
echo ""
echo "For automated news ingestion, add to crontab:"
echo "  */15 * * * * curl -X POST https://newscast.t0r.tech/api/ingest"
echo ""
