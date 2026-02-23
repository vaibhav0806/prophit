import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '@/components/error-boundary'

function ProblemChild(): JSX.Element {
  throw new Error('Test explosion')
}

function GoodChild() {
  return <div>All good</div>
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>,
    )

    expect(screen.getByText('All good')).toBeDefined()
  })

  it('catches errors and shows fallback UI', () => {
    // Suppress console.error from React and our boundary during this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeDefined()
    expect(screen.getByText('Test explosion')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined()

    spy.mockRestore()
  })

  it('resets when Try Again is clicked', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let shouldThrow = true

    function MaybeBroken() {
      if (shouldThrow) {
        throw new Error('Boom')
      }
      return <div>Recovered</div>
    }

    render(
      <ErrorBoundary>
        <MaybeBroken />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeDefined()

    // Fix the child before resetting
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(screen.getByText('Recovered')).toBeDefined()

    spy.mockRestore()
  })
})
