// src/types/midtrans-client.d.ts
declare module 'midtrans-client' {
  /** Konfigurasi client Midtrans */
  interface ClientConfig {
    isProduction?: boolean;
    serverKey?: string;
    clientKey?: string;
  }

  /** Bentuk error umum yang sering dilempar midtrans-client */
  export interface MidtransApiError extends Error {
    ApiResponse?: {
      status_message?: string;
      error_messages?: string[]; // kadang array
      status_code?: string | number;
      transaction_status?: string;
      [k: string]: any;
    };
    [k: string]: any;
  }

  /** Response Snap createTransaction yang biasa dipakai */
  export interface SnapTransactionResponse {
    token: string;
    redirect_url: string;
    [k: string]: any;
  }

  /** Snap client */
  export class Snap {
    constructor(config: ClientConfig);
    createTransaction(parameters: any): Promise<SnapTransactionResponse>;
    createTransactionToken(parameters: any): Promise<string>;
    createTransactionRedirectUrl(parameters: any): Promise<string>;
  }

  /** CoreApi (kalau suatu saat kamu pakai) */
  export class CoreApi {
    constructor(config: ClientConfig);
    charge(parameters: any): Promise<any>;
    capture(parameters: any): Promise<any>;
    transactions: {
      status(orderId: string): Promise<any>;
      approve(orderId: string): Promise<any>;
      cancel(orderId: string): Promise<any>;
      expire(orderId: string): Promise<any>;
      refund(orderId: string, params?: any): Promise<any>;
    };
  }

  // Default export (agar import default kamu bekerja)
  const Midtrans: {
    Snap: typeof Snap;
    CoreApi: typeof CoreApi;
  };

  export default Midtrans;
}
