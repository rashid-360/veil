"use client"

import { useState } from "react"


export default function Counterpage(){
const [count,setCount]=useState(0)

function click(){

    setCount(count+1)
}


    return(

<div>
test
<button onClick={click}>dsfsdfasd</button>
{count}

</div>

    )
}