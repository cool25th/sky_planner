export function HeroPlane() {
  return (
    <div className="hero-plane" aria-hidden="true">
      <svg viewBox="24 14 712 248" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="planeBody" x1="95" y1="84" x2="576" y2="236" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F9FBFF" />
            <stop offset="0.28" stopColor="#E7ECF4" />
            <stop offset="0.58" stopColor="#C9D4E2" />
            <stop offset="1" stopColor="#EDF2F8" />
          </linearGradient>
          <linearGradient id="planeWing" x1="415" y1="145" x2="694" y2="210" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E9EEF5" />
            <stop offset="1" stopColor="#C2CDDA" />
          </linearGradient>
          <linearGradient id="metalDark" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#5E6875" />
            <stop offset="1" stopColor="#141D28" />
          </linearGradient>
          <radialGradient id="engineGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) rotate(90) scale(54 54)">
            <stop stopColor="#F8FBFF" />
            <stop offset="0.55" stopColor="#B9C4D2" />
            <stop offset="1" stopColor="#495463" />
          </radialGradient>
          <filter id="shadow" x="0" y="0" width="760" height="300" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feDropShadow dx="0" dy="24" stdDeviation="18" floodColor="#A3B3C7" floodOpacity="0.24" />
          </filter>
        </defs>

        <g filter="url(#shadow)">
          <ellipse cx="330" cy="236" rx="230" ry="18" fill="rgba(25,49,73,0.1)" />
          <path
            d="M108 158C108 132 136 110 192 102L503 58C533 54 561 61 577 76L654 147C665 157 667 170 660 180C653 191 638 197 617 198H286C246 198 218 205 203 220L192 230C181 239 164 244 144 244H129C111 244 100 236 97 224L91 193C90 189 89 184 89 180C89 174 91 169 94 164C97 160 101 158 108 158Z"
            fill="url(#planeBody)"
          />
          <path
            d="M283 95C300 77 320 65 344 59L386 49C405 44 418 46 425 54C431 62 429 72 418 86L386 123H298C280 123 274 114 283 95Z"
            fill="#F6F9FD"
          />
          <path
            d="M471 144L658 151C674 152 682 161 680 178C678 192 667 199 648 199H456L471 144Z"
            fill="url(#planeWing)"
          />
          <path
            d="M338 144L196 108C180 104 175 94 182 78C189 62 202 58 221 66L401 135L338 144Z"
            fill="#D7E0EB"
          />
          <path
            d="M523 70L595 28C608 20 620 21 631 30C642 39 643 50 633 63L592 118L523 111V70Z"
            fill="#E5EBF3"
          />

          <g>
            <circle cx="487" cy="187" r="40" fill="url(#engineGlow)" />
            <circle cx="487" cy="187" r="28" fill="url(#metalDark)" />
            <circle cx="487" cy="187" r="16" fill="#8F9DAE" />
          </g>
          <g>
            <circle cx="595" cy="190" r="42" fill="url(#engineGlow)" />
            <circle cx="595" cy="190" r="29" fill="url(#metalDark)" />
            <circle cx="595" cy="190" r="17" fill="#8F9DAE" />
          </g>

          {Array.from({ length: 11 }).map((_, index) => (
            <rect
              key={index}
              x={278 + index * 19}
              y={111 + (index % 2 === 0 ? 0 : 2)}
              width="10"
              height="6"
              rx="3"
              fill="#182738"
              opacity="0.7"
            />
          ))}
          <path d="M113 164L170 155C179 154 185 160 184 169C183 177 176 183 167 183H113C102 183 99 166 113 164Z" fill="#FFE299" />
        </g>
      </svg>
    </div>
  );
}
