import React from 'react';

const ContactUs: React.FC = () => (
  <div className="w-full min-w-0">
    <div className="mb-5">
      <h3 className="text-xl font-bold text-gray-800 sm:text-2xl">Contact Us</h3>
      <p className="mt-1 text-sm text-gray-500">Admin contact information.</p>
    </div>
    <div className="rounded-xl border bg-white p-4 sm:p-5">
      <div className="text-sm font-semibold text-gray-500">Vendor</div>
      <a
        href="mailto:gocanteen1729@gmail.com"
        className="mt-1 inline-block break-all text-base font-semibold text-primary-700 hover:underline"
      >
        gocanteen1729@gmail.com
      </a>
    </div>
  </div>
);

export default ContactUs;
