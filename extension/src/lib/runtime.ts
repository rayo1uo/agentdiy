import type { RuntimeRequest, RuntimeResponse } from "@/shared/messages";

export const sendRuntimeMessage = async <T>(request: RuntimeRequest): Promise<T> => {
  const response = (await chrome.runtime.sendMessage(request)) as RuntimeResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Unknown runtime error");
  }
  return response.data as T;
};
