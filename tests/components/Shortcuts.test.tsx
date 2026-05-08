import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

import { Shortcuts } from '@/components/Shortcuts'

describe('Shortcuts', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('pressing ? opens the panel and pressing ? again closes it', () => {
    render(<Shortcuts />)
    expect(screen.queryByText('键盘快捷键')).not.toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(window, { key: '?' })
    })
    expect(screen.getByText('键盘快捷键')).toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(window, { key: '?' })
    })
    expect(screen.queryByText('键盘快捷键')).not.toBeInTheDocument()
  })

  it('pressing n routes to /matches/new', () => {
    render(<Shortcuts />)
    act(() => {
      fireEvent.keyDown(window, { key: 'n' })
    })
    expect(push).toHaveBeenCalledWith('/matches/new')
  })

  it('pressing g h routes to Lobby', () => {
    render(<Shortcuts />)
    act(() => {
      fireEvent.keyDown(window, { key: 'g' })
      fireEvent.keyDown(window, { key: 'h' })
    })
    expect(push).toHaveBeenCalledWith('/')
  })

  it('ignores keystrokes while an input is focused', () => {
    render(
      <>
        <input data-testid="focus-me" />
        <Shortcuts />
      </>,
    )
    const input = screen.getByTestId('focus-me')
    input.focus()
    act(() => {
      fireEvent.keyDown(input, { key: 'n' })
    })
    expect(push).not.toHaveBeenCalled()
  })
})
