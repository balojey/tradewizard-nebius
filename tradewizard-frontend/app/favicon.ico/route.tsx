import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 24,
          background: 'linear-gradient(135deg, #111827 0%, #000000 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#818cf8',
          fontWeight: 900,
          fontFamily: 'system-ui, sans-serif',
          borderRadius: '4px',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        T
      </div>
    ),
    {
      width: 32,
      height: 32,
    }
  )
}