import { describe, expect, it, vi } from 'vitest'
import { mountAccountChallenge } from './account-turnstile'

describe('account security challenge lifecycle', () => {
  it('returns token, clears expired/error tokens and removes widget on cleanup', () => {
    const render = vi.fn().mockReturnValue('widget')
    const remove = vi.fn()
    const onToken = vi.fn()
    const dispose = mountAccountChallenge(
      { render, remove },
      {} as HTMLElement,
      'public-site-key',
      onToken,
    )
    const callbacks = render.mock.calls[0]?.[1]
    callbacks.callback('challenge-token')
    callbacks['expired-callback']()
    callbacks['error-callback']()
    dispose()
    expect(onToken.mock.calls).toEqual([['challenge-token'], [''], [''], ['']])
    expect(remove).toHaveBeenCalledWith('widget')
  })
})
