import { CreatePaymentRequest } from "../../types/index.js";

export const WaveProvider = {
  createPayment: async (req: CreatePaymentRequest): Promise<any> => {
    try {
      const reqOpt = {
        method: "POST",
        headers: {
          // 'Authorization' : "Bearer 12345",
          "User-Agent": "undici-stream-example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req),
      };
      const payment = await fetch("http://localhost:3000/payments", reqOpt);
      //   HAND ERROR RESPONSE
      return await payment.json();
    } catch (e) {
      console.error("Payment error ", e);
      throw e;
    }
  },

  verifyPayment: async (ref: string) => {
    ref = "TXN-123456";
    const paymentVerification = await fetch(`http://localhost:3000/pay/${ref}`);

    //   HANFLE ERROR RESPONSE
    return  await paymentVerification.json();
  },
};

{
  // parameters in Wave API requests or attributes in API objects 
  amount  : "" // => string
  currency : "XOF" // => ISO  4217
  timestamp : "XOF" // =>  ISO 8601
transctionType :""
}