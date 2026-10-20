import type { AudioDevice, AudioDevices } from "@shared/types"

/**
 * Audio device discovery and selection.
 *
 * Chromium only reveals device *names* once the microphone has been opened
 * at least once, so the list is refreshed after every capture. The chosen
 * devices are stored in the settings and applied to the engine whenever they
 * change.
 */

export async function listDevices(): Promise<AudioDevices> {
  try {
    return await window.jarvis.audio.devices()
  } catch (err) {
    return {
      inputs: [],
      outputs: [],
      permitted: false,
      canSelectOutput: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** The label of a device, falling back to a friendly placeholder. */
export function deviceLabel(device: AudioDevice | undefined, fallback: string): string {
  if (!device) return fallback
  return device.label || fallback
}

/** Find a device by id. */
export function findDevice(devices: AudioDevice[], deviceId: string): AudioDevice | undefined {
  if (!deviceId) return undefined
  return devices.find((d) => d.deviceId === deviceId)
}
